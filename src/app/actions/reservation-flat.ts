"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, getCurrentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { getOrCreateFlatBatchId } from "@/lib/reservation-flat";
import { windowKeyAt } from "@/lib/schedule";
import { logError } from "@/lib/log";
import { notifyMerchantsReservationProductAdded } from "@/lib/push";

type ResvHoldResult = { ok: boolean; error?: string; available?: number };

async function requireHotdealMerchant() {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || user.role !== "MERCHANT_HOTDEAL") {
    return null;
  }
  return user;
}

const toInt = (v: unknown, min = 0) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[^\d-]/g, "")));
  return Number.isFinite(n) && n >= min ? n : min;
};

// datetime-local(브라우저=KST 가정) "YYYY-MM-DDTHH:MM[:SS]" → UTC Date(+09:00).
function parseCloseAtKst(local: string): Date | null {
  const s = String(local ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const withSec = s.length === 16 ? `${s}:00` : s;
  const d = new Date(`${withSec}+09:00`);
  return isNaN(d.getTime()) ? null : d;
}
// UTC Date → KST YYYY-MM-DD
function kstDateOf(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export type FlatProductState = { ok?: boolean; error?: string };

// 관리자: 신규 '단일 목록' 예약상품 등록/수정/삭제. 상품별 마감(closeAt, 시분초) + 픽업(출고)일.
export async function saveFlatProductAction(
  _prev: FlatProductState,
  formData: FormData,
): Promise<FlatProductState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const deleted = formData.get("deleted") === "true";

  if (deleted) {
    if (!id) return { error: "잘못된 요청이에요." };
    await prisma.reservationProduct.updateMany({
      where: { id, closeAt: { not: null } },
      data: { active: false },
    });
    await writeAudit({
      action: "reservation.flatDelete",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "ReservationProduct",
      targetId: id,
      summary: "예약상품 삭제(숨김)",
    }).catch(() => {});
    revalidatePath("/admin/reservations");
    revalidatePath("/reservations");
    return { ok: true };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const closeAt = parseCloseAtKst(String(formData.get("closeAt") ?? ""));
  const pickupDate = String(formData.get("pickupDate") ?? "").trim();
  const supplyPrice = toInt(formData.get("supplyPrice"), 0);
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "").trim();

  if (!name) return { error: "상품명을 입력하세요." };
  if (!closeAt) return { error: "예약 마감 시각을 정확히 입력하세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return { error: "픽업(출고)일을 선택하세요." };
  if (pickupDate < kstDateOf(closeAt)) {
    return { error: "픽업(출고)일은 예약 마감일 이후여야 해요." };
  }

  if (id) {
    const existing = await prisma.reservationProduct.findFirst({
      where: { id, closeAt: { not: null } },
      select: { id: true },
    });
    if (!existing) return { error: "상품을 찾을 수 없어요." };
    await prisma.$transaction([
      prisma.reservationProduct.update({
        where: { id },
        data: { name, closeAt, pickupDate, supplyPrice, inventoryItemId, active: true },
      }),
      // 픽업/이름 변경분을 미차감 예약 스냅샷에 전파(자동로드 필터 정합) — 레거시 저장 액션과 동일 규칙.
      prisma.reservationOrderItem.updateMany({
        where: { productId: id, stockDeductedAt: null },
        data: { pickupDate, name },
      }),
    ]);
  } else {
    const batchId = await getOrCreateFlatBatchId();
    const maxAgg = await prisma.reservationProduct.aggregate({
      where: { batchId },
      _max: { sortOrder: true },
    });
    await prisma.reservationProduct.create({
      data: {
        batchId,
        name,
        closeAt,
        pickupDate,
        supplyPrice,
        inventoryItemId,
        sortOrder: (maxAgg._max.sortOrder ?? 0) + 1,
        active: true,
      },
    });
    // 신규 등록만 점주 전체에 푸시(수정은 제외).
    await notifyMerchantsReservationProductAdded(name);
  }

  await writeAudit({
    action: id ? "reservation.flatUpdate" : "reservation.flatCreate",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationProduct",
    targetId: id || "",
    summary: `예약상품 ${name} · 픽업 ${pickupDate}`,
  }).catch(() => {});

  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");
  revalidatePath("/admin/calendar");
  return { ok: true };
}

// ── 점주(핫딜마켓) flat 예약 — 품목별 확정/해제 + 재고연동 실시간 담기 ───────────

// 수기 상품 발주 확정 = 수량 저장 + 품목별 확정(confirmedAt). qty<=0 이면 예약 취소(행 삭제). 마감 전에만.
export async function confirmFlatProductAction(input: {
  productId: string;
  qty: number;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireHotdealMerchant();
  if (!user) return { ok: false, error: "권한이 없어요." };
  const productId = String(input?.productId ?? "");
  const qty = Math.max(0, Math.floor(Number(input?.qty) || 0));

  const product = await prisma.reservationProduct.findFirst({
    where: { id: productId, active: true, closeAt: { not: null }, batch: { active: true } },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      closeAt: true,
      batchId: true,
      inventoryItemId: true,
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: "예약이 마감됐어요." };
  }

  const order = await prisma.reservationOrder.upsert({
    where: { userId_batchId: { userId: user.id, batchId: product.batchId } },
    create: { userId: user.id, batchId: product.batchId },
    update: {},
    select: { id: true },
  });

  if (product.inventoryItemId) {
    // 재고연동 — 수량은 담기(holdFlatProductAction)가 관리. 담아둔 수량을 '발주 확정'만 한다.
    const item = await prisma.reservationOrderItem.findUnique({
      where: { orderId_productId: { orderId: order.id, productId } },
      select: { qty: true },
    });
    if (!item || item.qty <= 0) return { ok: false, error: "수량을 먼저 담아 주세요." };
    await prisma.reservationOrderItem.update({
      where: { orderId_productId: { orderId: order.id, productId } },
      data: { confirmedAt: new Date() },
    });
  } else if (qty <= 0) {
    await prisma.reservationOrderItem.deleteMany({ where: { orderId: order.id, productId } });
  } else {
    await prisma.reservationOrderItem.upsert({
      where: { orderId_productId: { orderId: order.id, productId } },
      create: {
        orderId: order.id,
        productId,
        name: product.name,
        supplyPrice: product.supplyPrice,
        pickupDate: product.pickupDate,
        inventoryItemId: "",
        qty,
        confirmedAt: new Date(),
      },
      update: {
        qty,
        confirmedAt: new Date(),
        name: product.name,
        supplyPrice: product.supplyPrice,
        pickupDate: product.pickupDate,
      },
    });
  }
  revalidatePath("/reservations");
  revalidatePath("/order");
  return { ok: true };
}

// 수정 = 품목별 확정 해제(confirmedAt=null, 수량 유지). 마감 전에만.
export async function unlockFlatProductAction(input: {
  productId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const user = await requireHotdealMerchant();
  if (!user) return { ok: false, error: "권한이 없어요." };
  const productId = String(input?.productId ?? "");
  const product = await prisma.reservationProduct.findFirst({
    // 수기·연동 공통. 연동도 발주 확정(confirmedAt)을 쓰므로 잠금해제 가능(수량 홀드는 유지).
    where: { id: productId, active: true, closeAt: { not: null } },
    select: { closeAt: true },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: "예약이 마감됐어요." };
  }
  await prisma.reservationOrderItem.updateMany({
    where: { productId, order: { userId: user.id } },
    data: { confirmedAt: null },
  });
  revalidatePath("/reservations");
  revalidatePath("/order");
  return { ok: true };
}

// 재고연동 상품 실시간 담기 = 즉시 홀드(qty=홀드)만. 마감 전·재고 캡. qty0=취소.
// 공구로 나가는 '발주 확정'은 confirmFlatProductAction(별도 버튼)에서 confirmedAt을 찍는다.
export async function holdFlatProductAction(input: {
  productId: string;
  qty: number;
}): Promise<ResvHoldResult> {
  const user = await requireHotdealMerchant();
  if (!user) return { ok: false, error: "권한이 없어요." };
  const productId = String(input?.productId ?? "");
  const qty = Math.max(0, Math.floor(Number(input?.qty) || 0));

  const product = await prisma.reservationProduct.findFirst({
    where: {
      id: productId,
      active: true,
      closeAt: { not: null },
      inventoryItemId: { not: "" },
      batch: { active: true },
    },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      inventoryItemId: true,
      closeAt: true,
      batchId: true,
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: "예약이 마감됐어요." };
  }
  const itemId = product.inventoryItemId;

  try {
    const res = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { qty: true, deletedAt: true },
      });
      if (!item || item.deletedAt) return { ok: false, error: "재고 품목을 찾을 수 없어요." };

      // 이 품목에 걸린 '아직 차감 안 된' 전체 예약홀드(연동·활성배치·flat+레거시) − 내 이 상품 현재 수량.
      // ⚠ pickupDate 기준으로 거르면 당일픽업 상품이 10시 이후 자기 홀드를 제외해 초과판매가 나므로,
      //   stockDeductedAt:null(=아직 재고에서 안 뺀 살아있는 홀드) 기준으로 센다(재고현황 시드와 동일).
      const resvRows = await tx.reservationOrderItem.findMany({
        where: {
          inventoryItemId: itemId,
          stockDeductedAt: null,
          qty: { gt: 0 },
          order: { batch: { active: true } },
        },
        select: { qty: true, productId: true, order: { select: { userId: true } } },
      });
      let resvHeld = 0;
      let myThis = 0;
      for (const r of resvRows) {
        resvHeld += r.qty;
        if (r.order.userId === user.id && r.productId === productId) myThis += r.qty;
      }
      const dayAgg = await tx.stockHold.aggregate({
        where: { itemId, windowDate: windowKeyAt() },
        _sum: { qty: true },
      });
      const availableForMe = item.qty - (resvHeld - myThis) - (dayAgg._sum.qty ?? 0);

      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId: user.id, batchId: product.batchId } },
        select: { id: true },
      });
      if (qty <= 0) {
        if (order)
          await tx.reservationOrderItem.deleteMany({ where: { orderId: order.id, productId } });
        return { ok: true, available: Math.max(0, availableForMe) };
      }
      if (qty > availableForMe) {
        return {
          ok: false,
          error: `남은 수량이 부족해요. (담을 수 있는 최대 ${Math.max(0, availableForMe)}개)`,
          available: Math.max(0, availableForMe),
        };
      }
      const oid =
        order?.id ??
        (
          await tx.reservationOrder.create({
            data: { userId: user.id, batchId: product.batchId },
            select: { id: true },
          })
        ).id;
      // 담기 = 재고 홀드(qty)만. 공구로 나가는 '발주 확정'(confirmedAt)은 별도 버튼(confirmFlatProductAction).
      await tx.reservationOrderItem.upsert({
        where: { orderId_productId: { orderId: oid, productId } },
        create: {
          orderId: oid,
          productId,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: itemId,
          qty,
        },
        update: {
          qty,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: itemId,
        },
      });
      return { ok: true, available: Math.max(0, availableForMe - qty) };
    });
    revalidatePath("/reservations");
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("reservation.holdFlat", err, { productId, userId: user.id });
    return { ok: false, error: "담기에 실패했어요. 다시 시도해 주세요." };
  }
}
