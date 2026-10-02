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
  // 지점별 예약발주 노출 off면 현행(flat) 예약 액션(확정·해제·담기)도 전부 차단 — UI는 라우트 게이트로
  // 가려지지만 서버액션은 POST 엔드포인트라 직접 호출 방어가 필요하다(회원관리 토글).
  if (!user.reservationEnabled) {
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
  // 세트 구성품(선택) — UI가 JSON으로 보냄. 1개 이상이면 '세트', 비어있으면 기존 단일 상품.
  //  구성품: { name, inventoryItemId(""=수기), qtyPerUnit(세트당 수량), supplyPrice(연동이면 재고가 자동기본, 수정값 우선) }
  let components: { name: string; inventoryItemId: string; qtyPerUnit: number; supplyPrice: number }[] = [];
  try {
    const arr = JSON.parse(String(formData.get("components") ?? "[]"));
    if (Array.isArray(arr)) {
      components = arr
        .map((c) => ({
          name: String(c?.name ?? "").trim().slice(0, 100),
          inventoryItemId: String(c?.inventoryItemId ?? "").trim(),
          qtyPerUnit: Math.max(1, toInt(c?.qtyPerUnit, 1)),
          supplyPrice: toInt(c?.supplyPrice, 0),
        }))
        .filter((c) => c.name);
    }
  } catch {
    /* 잘못된 JSON은 단일 상품으로 취급 */
  }
  const isSet = components.length > 0;

  // 단일 상품 입력값(세트면 무시 — 연동은 구성품이 각자, 가격은 구성품 합).
  const singlePrice = toInt(formData.get("supplyPrice"), 0);
  const singleInv = String(formData.get("inventoryItemId") ?? "").trim();
  // 세트 공급가 = Σ(구성품 공급가 × 세트당 수량). 세트는 상품 자체 재고연동 없음(inventoryItemId="").
  const supplyPrice = isSet
    ? components.reduce((s, c) => s + c.supplyPrice * c.qtyPerUnit, 0)
    : singlePrice;
  const inventoryItemId = isSet ? "" : singleInv;
  // 재고 고정(초과발주 금지). 세트는 연동 구성품이 하나라도 있으면 의미 있음.
  const hasLinked = isSet ? components.some((c) => c.inventoryItemId) : !!inventoryItemId;
  const stockFixed = hasLinked ? formData.get("stockFixed") === "true" : false;

  if (!name) return { error: "상품명을 입력하세요." };
  if (!closeAt) return { error: "예약 마감 시각을 정확히 입력하세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return { error: "픽업(출고)일을 선택하세요." };
  if (pickupDate < kstDateOf(closeAt)) {
    return { error: "픽업(출고)일은 예약 마감일 이후여야 해요." };
  }

  const componentData = components.map((c, i) => ({
    name: c.name,
    inventoryItemId: c.inventoryItemId,
    qtyPerUnit: c.qtyPerUnit,
    supplyPrice: c.supplyPrice,
    sortOrder: i,
  }));

  if (id) {
    const existing = await prisma.reservationProduct.findFirst({
      where: { id, closeAt: { not: null } },
      select: { id: true },
    });
    if (!existing) return { error: "상품을 찾을 수 없어요." };
    await prisma.$transaction([
      prisma.reservationProduct.update({
        where: { id },
        data: { name, closeAt, pickupDate, supplyPrice, inventoryItemId, stockFixed, active: true },
      }),
      // 세트 구성품은 전량 교체(삭제 후 재생성) — 수정 시 최신 구성으로 덮어씀.
      prisma.reservationProductComponent.deleteMany({ where: { productId: id } }),
      ...(componentData.length > 0
        ? [prisma.reservationProductComponent.createMany({ data: componentData.map((c) => ({ ...c, productId: id })) })]
        : []),
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
        stockFixed,
        sortOrder: (maxAgg._max.sortOrder ?? 0) + 1,
        active: true,
        ...(componentData.length > 0 ? { components: { create: componentData } } : {}),
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
  const qty = Math.min(99999, Math.max(0, Math.floor(Number(input?.qty) || 0))); // 상한(오타·폭주 방지)

  const product = await prisma.reservationProduct.findFirst({
    where: { id: productId, active: true, closeAt: { not: null }, batch: { active: true } },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      closeAt: true,
      batchId: true,
      inventoryItemId: true,
      components: { where: { inventoryItemId: { not: "" } }, select: { id: true } },
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: "예약이 마감됐어요." };
  }
  // 연동 세트(연동 구성품 보유)도 재고연동 단일처럼 '담아둔 수량 확정'. 수기(단일·수기전용 세트)만 수량 직접 저장.
  const isLinked = !!product.inventoryItemId || product.components.length > 0;

  const order = await prisma.reservationOrder.upsert({
    where: { userId_batchId: { userId: user.id, batchId: product.batchId } },
    create: { userId: user.id, batchId: product.batchId },
    update: {},
    select: { id: true },
  });

  if (isLinked) {
    // 재고연동(단일/세트) — 수량은 담기(hold)가 관리. 담아둔 수량을 '발주 확정'만 한다.
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
  const qty = Math.min(99999, Math.max(0, Math.floor(Number(input?.qty) || 0))); // 상한(오타·폭주 방지)

  const product = await prisma.reservationProduct.findFirst({
    where: {
      id: productId,
      active: true,
      closeAt: { not: null },
      batch: { active: true },
    },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      inventoryItemId: true,
      closeAt: true,
      batchId: true,
      stockFixed: true,
      components: {
        where: { inventoryItemId: { not: "" } },
        select: { inventoryItemId: true, qtyPerUnit: true },
      },
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: "예약이 마감됐어요." };
  }

  // 세트(연동 구성품 보유) — 구성품 전부 잠그고 '만들 수 있는 세트 수'(구성품별 최소)로 판정, 세트 주문행 1개 저장.
  if (product.components.length > 0) {
    return holdSetProduct(user.id, productId, qty, product);
  }
  if (!product.inventoryItemId) {
    return { ok: false, error: "담기 대상이 아니에요." }; // 수기 단일은 '발주 확정'으로 처리
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
      // 재고 고정 상품만 재고까지 하드 캡. 기본(초과발주 허용)은 재고 넘어도 담긴다(부족분=관리자 조달).
      // 단 '줄이기'(qty ≤ 내 현재수량 myThis)는 항상 허용 — 같은 재고를 쓰는 다른 상품이 초과발주해
      // availableForMe 가 음수여도 내 수량을 낮추는 건 재고를 더 쓰지 않으므로 막지 않는다.
      if (product.stockFixed && qty > myThis && qty > availableForMe) {
        return {
          ok: false,
          error: `남은 수량이 부족해요. (담을 수 있는 최대 ${Math.max(myThis, availableForMe)}개)`,
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

// 세트 담기 — 연동 구성품 전부 FOR UPDATE 잠그고 '만들 수 있는 세트 수'(구성품별 남은÷세트당수량 중 최소)로 판정.
// 세트 주문행 1개(inventoryItemId="")만 저장(수량=세트수). 재고 홀드는 reservation-stock 의 setComponentDemand 가 전개 집계.
async function holdSetProduct(
  userId: string,
  productId: string,
  qtySets: number,
  product: {
    name: string;
    supplyPrice: number;
    pickupDate: string;
    batchId: string;
    stockFixed: boolean;
    components: { inventoryItemId: string; qtyPerUnit: number }[];
  },
): Promise<ResvHoldResult> {
  const comps = product.components;
  const itemIds = [...new Set(comps.map((c) => c.inventoryItemId))];
  try {
    const res = await prisma.$transaction(async (tx) => {
      for (const id of itemIds) {
        await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${id} FOR UPDATE`;
      }
      const invs = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, qty: true, deletedAt: true },
      });
      const baseById = new Map(invs.map((i) => [i.id, i]));
      for (const id of itemIds) {
        const inv = baseById.get(id);
        if (!inv || inv.deletedAt) return { ok: false, error: "세트 구성품 재고를 찾을 수 없어요." };
      }

      // 활성 세트 전부 + 연동 구성품(세트별 item→세트당수량) — 세트 홀드를 구성품으로 전개해 합산.
      const allSets = await tx.reservationProduct.findMany({
        where: { active: true, components: { some: { inventoryItemId: { not: "" } } } },
        select: {
          id: true,
          components: { where: { inventoryItemId: { not: "" } }, select: { inventoryItemId: true, qtyPerUnit: true } },
        },
      });
      const compMap = new Map(allSets.map((s) => [s.id, s.components]));
      const setIds = allSets.map((s) => s.id);
      const [singleRows, setRows, dayHolds] = await Promise.all([
        tx.reservationOrderItem.findMany({
          where: { inventoryItemId: { in: itemIds }, stockDeductedAt: null, qty: { gt: 0 }, order: { batch: { active: true } } },
          select: { inventoryItemId: true, qty: true },
        }),
        tx.reservationOrderItem.findMany({
          where: { productId: { in: setIds }, stockDeductedAt: null, qty: { gt: 0 }, order: { batch: { active: true } } },
          select: { productId: true, qty: true, order: { select: { userId: true } } },
        }),
        tx.stockHold.groupBy({ by: ["itemId"], where: { itemId: { in: itemIds }, windowDate: windowKeyAt() }, _sum: { qty: true } }),
      ]);
      const dayById = new Map(dayHolds.map((d) => [d.itemId, d._sum.qty ?? 0]));
      const totalHeld: Record<string, number> = {};
      const myThis: Record<string, number> = {};
      let myCurrentSets = 0;
      for (const r of singleRows) totalHeld[r.inventoryItemId] = (totalHeld[r.inventoryItemId] ?? 0) + r.qty;
      for (const r of setRows) {
        const cs = compMap.get(r.productId) ?? [];
        const mineThisSet = r.order.userId === userId && r.productId === productId;
        if (mineThisSet) myCurrentSets += r.qty;
        for (const c of cs) {
          totalHeld[c.inventoryItemId] = (totalHeld[c.inventoryItemId] ?? 0) + r.qty * c.qtyPerUnit;
          if (mineThisSet) myThis[c.inventoryItemId] = (myThis[c.inventoryItemId] ?? 0) + r.qty * c.qtyPerUnit;
        }
      }
      let availableSets = Infinity;
      for (const c of comps) {
        const base = baseById.get(c.inventoryItemId)!.qty;
        const others = (totalHeld[c.inventoryItemId] ?? 0) - (myThis[c.inventoryItemId] ?? 0);
        const remain = base - others - (dayById.get(c.inventoryItemId) ?? 0);
        availableSets = Math.min(availableSets, Math.floor(remain / Math.max(1, c.qtyPerUnit)));
      }
      if (!Number.isFinite(availableSets)) availableSets = 0;

      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId, batchId: product.batchId } },
        select: { id: true },
      });
      if (qtySets <= 0) {
        if (order) await tx.reservationOrderItem.deleteMany({ where: { orderId: order.id, productId } });
        return { ok: true, available: Math.max(0, availableSets) };
      }
      // 재고 고정이면 세트 재고까지만(증가 시). 줄이기는 항상 허용.
      if (product.stockFixed && qtySets > myCurrentSets && qtySets > availableSets) {
        return {
          ok: false,
          error: `세트 재고가 부족해요. (담을 수 있는 최대 ${Math.max(myCurrentSets, availableSets)}세트)`,
          available: Math.max(0, availableSets),
        };
      }
      const oid =
        order?.id ??
        (await tx.reservationOrder.create({ data: { userId, batchId: product.batchId }, select: { id: true } })).id;
      await tx.reservationOrderItem.upsert({
        where: { orderId_productId: { orderId: oid, productId } },
        create: {
          orderId: oid,
          productId,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: "",
          qty: qtySets,
        },
        update: { qty: qtySets, name: product.name, supplyPrice: product.supplyPrice, pickupDate: product.pickupDate, inventoryItemId: "" },
      });
      return { ok: true, available: Math.max(0, availableSets - qtySets) };
    });
    revalidatePath("/reservations");
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("reservation.holdSet", err, { productId, userId });
    return { ok: false, error: "담기에 실패했어요. 다시 시도해 주세요." };
  }
}
