"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMerchant, getCurrentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { validateBatchDates, isReservationClosed } from "@/lib/reservation";
import {
  reservationLockActiveAt,
  minLockedPickupDate,
} from "@/lib/reservation-stock";
import { windowKeyAt } from "@/lib/schedule";
import { logError } from "@/lib/log";

export type ReservationBatchState = { ok?: boolean; error?: string };

type ProductInput = {
  id?: string | null;
  name?: string;
  supplyPrice?: string | number;
  pickupDate?: string; // 상품별 픽업일자 KST YYYY-MM-DD
  inventoryItemId?: string; // 재고현황 연동(빈값=수기)
  deleted?: boolean;
};
type BatchPayload = {
  batchId?: string | null;
  reserveDate?: string;
  products?: ProductInput[];
};

const toInt = (v: unknown, min = 0) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[^\d-]/g, "")));
  return Number.isFinite(n) && n >= min ? n : min;
};

// 관리자: 예약 배치(예약일자·픽업일자) + 상품 카탈로그 저장(생성/수정/소프트삭제).
export async function saveReservationBatchAction(
  _prev: ReservationBatchState,
  formData: FormData,
): Promise<ReservationBatchState> {
  const admin = await requireAdmin();
  let payload: BatchPayload = {};
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "입력을 읽지 못했어요. 다시 시도해 주세요." };
  }

  const reserveDate = String(payload.reserveDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reserveDate)) return { error: "예약일자를 선택하세요." };

  const products = Array.isArray(payload.products) ? payload.products : [];
  const batchId = payload.batchId ? String(payload.batchId) : null;

  // 픽업일은 이제 '상품별'. 살아있는(삭제 안 됨) 이름 있는 상품마다 픽업일 필수 + 예약 다음날부터.
  const liveNamed = products.filter((p) => !p.deleted && String(p.name ?? "").trim());
  for (const p of liveNamed) {
    const pk = String(p.pickupDate ?? "").trim();
    const v = validateBatchDates(reserveDate, pk);
    if (!v.ok) return { error: `'${String(p.name).trim()}' — ${v.error}` };
  }
  // 배치 pickupDate는 하위호환용 대표값(상품 픽업 중 가장 이른 날). 상품 없으면 예약일 폴백.
  const pickups = liveNamed.map((p) => String(p.pickupDate).trim());
  const batchPickup = pickups.length ? pickups.slice().sort()[0] : reserveDate;

  let targetId = batchId;
  let created = false;

  if (batchId) {
    const existing = await prisma.reservationBatch.findFirst({
      where: { id: batchId, active: true },
      select: {
        id: true,
        reserveDate: true,
        // '확정된' 예약만 센다 — 점주가 '수정'(잠금해제)만 누르고 방치하면 confirmed:false 행이
        // 남는데, 이를 세면 실제 확정이 없는데도 관리자가 예약일자를 영영 못 바꾸게 된다.
        _count: { select: { orders: { where: { confirmed: true } } } },
      },
    });
    if (!existing) return { error: "예약 배치를 찾을 수 없어요." };
    // 확정 예약이 있으면 '예약일자'만 고정(마감 타이밍 보호). 상품별 픽업은 아이템 스냅샷으로
    // 보호되므로(확정분은 각자 스냅샷 픽업일을 유지) 관리자가 카탈로그 픽업을 조정해도 안전.
    const locked = existing._count.orders > 0;
    if (locked && reserveDate !== existing.reserveDate) {
      return { error: "이미 예약이 접수된 배치는 예약일자를 바꿀 수 없어요." };
    }
    if (!locked && reserveDate !== existing.reserveDate) {
      const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
      if (dup && dup.id !== batchId) return { error: "그 예약일자는 이미 있어요." };
    }
    await prisma.reservationBatch.update({
      where: { id: batchId },
      data: { reserveDate: locked ? existing.reserveDate : reserveDate, pickupDate: batchPickup },
    });
  } else {
    const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
    if (dup) {
      return { error: "그 예약일자는 이미 있어요. 기존 예약을 눌러 수정해 주세요." };
    }
    const b = await prisma.reservationBatch.create({
      data: { reserveDate, pickupDate: batchPickup },
      select: { id: true },
    });
    targetId = b.id;
    created = true;
  }

  if (!targetId) return { error: "저장에 실패했어요." };

  // 상품 upsert / 소프트삭제
  const maxAgg = await prisma.reservationProduct.aggregate({
    where: { batchId: targetId },
    _max: { sortOrder: true },
  });
  let nextSort = (maxAgg._max.sortOrder ?? 0) + 1;

  const ops = [];
  for (const p of products) {
    const pid = p.id ? String(p.id) : null;
    if (p.deleted) {
      if (pid) {
        ops.push(
          prisma.reservationProduct.updateMany({
            where: { id: pid, batchId: targetId },
            data: { active: false },
          }),
        );
      }
      continue;
    }
    const name = String(p.name ?? "").trim().slice(0, 100);
    if (!name) continue; // 이름 없는 빈 추가행 무시
    const supplyPrice = toInt(p.supplyPrice, 0);
    const pk = String(p.pickupDate ?? "").trim(); // 위에서 검증됨(예약+2 이상)
    const invId = String(p.inventoryItemId ?? "").trim(); // 연동 재고 품목(빈값=수기)
    if (pid) {
      ops.push(
        prisma.reservationProduct.updateMany({
          where: { id: pid, batchId: targetId },
          data: { name, supplyPrice, pickupDate: pk, inventoryItemId: invId, active: true },
        }),
      );
    } else {
      ops.push(
        prisma.reservationProduct.create({
          data: {
            batchId: targetId,
            name,
            supplyPrice,
            pickupDate: pk,
            inventoryItemId: invId,
            sortOrder: nextSort++,
            active: true,
          },
        }),
      );
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  await writeAudit({
    action: created ? "reservation.batchCreate" : "reservation.batchUpdate",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationBatch",
    targetId,
    summary: `예약 ${reserveDate} · 상품 ${liveNamed.length}개(픽업 상품별)`,
  });

  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");
  revalidatePath(`/admin/reservations/${targetId}`);

  // 저장 후 항상 '목록'으로 이동 — 서버 리다이렉트라 최신 목록이 그려져 방금 저장한 예약이
  // 바로 보인다(예전엔 신규는 편집페이지로 갔는데, 그러면 목록 클라 캐시가 오래돼 '목록에 안
  // 나온다'처럼 보였다). 편집은 목록에서 그 예약을 눌러 이어서.
  redirect("/admin/reservations");
}

// 관리자: 예약 배치 소프트삭제(숨김). 점주 예약이 있으면 경고만 하고 그대로 진행(집계는 남음).
export async function deleteReservationBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) redirect("/admin/reservations");
  const b = await prisma.reservationBatch.findUnique({
    where: { id: batchId },
    select: { reserveDate: true },
  });
  await prisma.reservationBatch.updateMany({
    where: { id: batchId },
    data: { active: false },
  });
  await writeAudit({
    action: "reservation.batchDelete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationBatch",
    targetId: batchId,
    summary: `예약일자 ${b?.reserveDate ?? "?"} 삭제(숨김)`,
  });
  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");
  redirect("/admin/reservations");
}

// ── 점주(핫딜마켓) 예약 확정/수정 ─────────────────────────────

// 확정 = 수량 저장 + 잠금. 마감 전에만. (0 수량만 있으면 클라에서 버튼 비활성 → 항상 1개↑ 전제)
export async function confirmReservationAction(formData: FormData) {
  const user = await requireMerchant(); // 로그인+APPROVED 강제(정지/미승인 점주 차단)
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const batchId = String(formData.get("batchId") ?? "");
  let raw: { productId?: string; qty?: number | string }[] = [];
  try {
    raw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    raw = [];
  }

  const batch = await prisma.reservationBatch.findFirst({
    where: { id: batchId, active: true },
    select: {
      reserveDate: true,
      products: {
        where: { active: true },
        select: { id: true, name: true, supplyPrice: true, pickupDate: true, inventoryItemId: true },
      },
    },
  });
  if (!batch) redirect("/reservations");
  if (isReservationClosed(batch.reserveDate)) redirect(`/reservations/${batchId}`); // 마감 후 확정 불가

  // 확정 흐름은 '수기 상품'만 다룬다 — 연동(재고) 상품은 실시간 담기(holdReservationAction)가 관리.
  const pmap = new Map(batch.products.map((p) => [p.id, p]));
  const clean = (Array.isArray(raw) ? raw : [])
    .map((i) => ({ productId: String(i.productId ?? ""), qty: toInt(i.qty, 0) }))
    .filter((i) => {
      const p = pmap.get(i.productId);
      return !!p && !p.inventoryItemId && i.qty > 0; // 연동 상품은 제외
    });

  const order = await prisma.reservationOrder.upsert({
    where: { userId_batchId: { userId: user.id, batchId } },
    create: { userId: user.id, batchId, confirmed: true, confirmedAt: new Date() },
    update: { confirmed: true, confirmedAt: new Date() },
    select: { id: true },
  });
  await prisma.$transaction([
    // 수기 상품행만 삭제/재생성 — 연동 상품행(inventoryItemId 있음)은 그대로 보존.
    prisma.reservationOrderItem.deleteMany({ where: { orderId: order.id, inventoryItemId: "" } }),
    ...clean.map((i, idx) => {
      const p = pmap.get(i.productId)!;
      return prisma.reservationOrderItem.create({
        data: {
          orderId: order.id,
          productId: i.productId,
          name: p.name,
          supplyPrice: p.supplyPrice,
          pickupDate: p.pickupDate, // 픽업일 스냅샷 — 확정 후 카탈로그 변경돼도 이 값으로 자동로드
          inventoryItemId: "", // 수기 상품
          qty: i.qty,
          sortOrder: idx,
        },
      });
    }),
  ]);

  revalidatePath("/reservations");
  revalidatePath(`/reservations/${batchId}`);
  redirect(`/reservations/${batchId}`);
}

// 수정 = 잠금 해제(수량은 유지). 마감 후엔 불가.
export async function unlockReservationAction(formData: FormData) {
  const user = await requireMerchant(); // 로그인+APPROVED 강제(정지/미승인 점주 차단)
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const batchId = String(formData.get("batchId") ?? "");
  const batch = await prisma.reservationBatch.findFirst({
    where: { id: batchId, active: true },
    select: { reserveDate: true },
  });
  if (!batch) redirect("/reservations");
  if (!isReservationClosed(batch.reserveDate)) {
    await prisma.reservationOrder.updateMany({
      where: { userId: user.id, batchId },
      data: { confirmed: false },
    });
  }
  revalidatePath(`/reservations/${batchId}`);
  redirect(`/reservations/${batchId}`);
}

// ── 연동(재고현황) 예약 상품 실시간 담기 ──────────────────────
// 재고에서 불러온 연동 상품은 일일 담기처럼 −/+ 하는 즉시 예약수량=홀드로 저장(공유·초과차단).
// confirmed 는 건드리지 않는다(수기 상품의 확정상태 보존). qty 0 이면 그 상품 예약행만 삭제.
export type ResvHoldResult = { ok: boolean; error?: string; available?: number };

export async function holdReservationAction(input: {
  batchId: string;
  productId: string;
  qty: number;
}): Promise<ResvHoldResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || user.role !== "MERCHANT_HOTDEAL") {
    return { ok: false, error: "권한이 없어요." };
  }
  const batchId = String(input.batchId ?? "");
  const productId = String(input.productId ?? "");
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));

  const product = await prisma.reservationProduct.findFirst({
    where: {
      id: productId,
      batchId,
      active: true,
      inventoryItemId: { not: "" },
      batch: { active: true },
    },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      inventoryItemId: true,
      batch: { select: { reserveDate: true } },
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (isReservationClosed(product.batch.reserveDate)) {
    return { ok: false, error: "예약이 마감됐어요." };
  }
  if (!reservationLockActiveAt(product.pickupDate)) {
    return { ok: false, error: "픽업일이 지나 담을 수 없어요." };
  }

  const itemId = product.inventoryItemId;
  const gte = minLockedPickupDate();

  try {
    const res = await prisma.$transaction(async (tx) => {
      // 일일 담기와 같은 락으로 이 품목 담기를 직렬화(동시 초과 방지)
      await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { qty: true, deletedAt: true },
      });
      if (!item || item.deletedAt) {
        return { ok: false, error: "재고 품목을 찾을 수 없어요." };
      }

      // 전체 예약홀드(연동·픽업 10시 전·활성 배치) − 내 이 상품 현재 수량
      const resvRows = await tx.reservationOrderItem.findMany({
        where: {
          inventoryItemId: itemId,
          pickupDate: { gte },
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
      // 일일 담기 홀드(연동 잠긴 품목이면 보통 0이나, 잠금 직전 담긴 게 있을 수 있어 함께 차감)
      const dayAgg = await tx.stockHold.aggregate({
        where: { itemId, windowDate: windowKeyAt() },
        _sum: { qty: true },
      });
      const availableForMe = item.qty - (resvHeld - myThis) - (dayAgg._sum.qty ?? 0);

      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId: user.id, batchId } },
        select: { id: true },
      });

      if (qty <= 0) {
        if (order) {
          await tx.reservationOrderItem.deleteMany({
            where: { orderId: order.id, productId },
          });
        }
        return { ok: true, available: Math.max(0, availableForMe) };
      }
      if (qty > availableForMe) {
        return {
          ok: false,
          error: `남은 수량이 부족해요. (담을 수 있는 최대 ${Math.max(0, availableForMe)}개)`,
          available: Math.max(0, availableForMe),
        };
      }
      // 주문 보장(confirmed 는 건드리지 않음 — 수기분 확정상태 유지)
      const oid =
        order?.id ??
        (
          await tx.reservationOrder.create({
            data: { userId: user.id, batchId, confirmed: false },
            select: { id: true },
          })
        ).id;
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
    revalidatePath(`/reservations/${batchId}`);
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("reservation.hold", err, { batchId, productId, userId: user.id });
    return { ok: false, error: "담기에 실패했어요. 다시 시도해 주세요." };
  }
}
