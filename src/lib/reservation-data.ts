// 예약발주 서버 데이터 접근(prisma) — 서버 컴포넌트/액션에서 사용. 순수계산은 lib/reservation.ts.
import { prisma } from "@/lib/prisma";
import { kstToday, shiftDate } from "@/lib/date";
import { isReservationClosed } from "@/lib/reservation";

export type ReservationBatchListItem = {
  id: string;
  reserveDate: string;
  pickupDates: string[]; // 이 예약일자에 올라온 상품들의 픽업일(중복제거·오름차순)
  productCount: number;
  orderCount: number;
};

// 활성 상품들의 픽업일 distinct 정렬 목록
function distinctPickups(products: { pickupDate: string }[]): string[] {
  return [...new Set(products.map((p) => p.pickupDate).filter(Boolean))].sort();
}

// 숨겨진(삭제·active=false) 예약 배치 수 — 관리자 '숨겨진 예약 정리' 버튼 노출 판단용.
export async function countHiddenReservationBatches(): Promise<number> {
  return prisma.reservationBatch.count({ where: { active: false } });
}

// 관리자 목록 — 활성 배치 + 상품/예약 건수 + 픽업일 목록. 예약일자 내림차순.
export async function getReservationBatchesAdmin(): Promise<ReservationBatchListItem[]> {
  const batches = await prisma.reservationBatch.findMany({
    where: { active: true },
    orderBy: { reserveDate: "desc" },
    select: {
      id: true,
      reserveDate: true,
      products: { where: { active: true }, select: { pickupDate: true } },
      _count: { select: { products: { where: { active: true } }, orders: true } },
    },
  });
  return batches.map((b) => ({
    id: b.id,
    reserveDate: b.reserveDate,
    pickupDates: distinctPickups(b.products),
    productCount: b._count.products,
    orderCount: b._count.orders,
  }));
}

export type ReservationProductRow = {
  id: string;
  name: string;
  supplyPrice: number;
  pickupDate: string;
  inventoryItemId: string; // 값 있으면 재고현황 연동 상품(실시간 담기), 빈값=수기
};

// 관리자 예약 등록 '재고현황에서 불러오기' 피커용 — 활성 재고 품목.
export async function getInventoryPickList(): Promise<
  { id: string; name: string; supplyPrice: number }[]
> {
  return prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, supplyPrice: true },
  });
}

export type ReservationBatchDetail = {
  id: string;
  reserveDate: string;
  pickupDates: string[]; // 상품들의 픽업일(distinct)
  products: ReservationProductRow[];
  hasOrders: boolean; // 확정 예약이 하나라도 있으면 예약일자 변경 잠금
};

export async function getReservationBatch(id: string): Promise<ReservationBatchDetail | null> {
  const b = await prisma.reservationBatch.findFirst({
    where: { id, active: true },
    select: {
      id: true,
      reserveDate: true,
      products: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, supplyPrice: true, pickupDate: true, inventoryItemId: true },
      },
      _count: { select: { orders: true } },
    },
  });
  if (!b) return null;
  return {
    id: b.id,
    reserveDate: b.reserveDate,
    pickupDates: distinctPickups(b.products),
    products: b.products,
    hasOrders: b._count.orders > 0,
  };
}

// ── 점주(핫딜마켓) ────────────────────────────────────────────

export type MerchantReservationListItem = {
  id: string;
  reserveDate: string;
  pickupDates: string[]; // 이 예약일자 상품들의 픽업일(중복제거·오름차순)
  productCount: number;
  confirmed: boolean;
  reservedQty: number; // 내가 예약한 총 수량
};

// 점주에게 보일 배치 — 활성 + '픽업 안 지난 상품'이 1개↑ 있는 배치. 내 예약 상태 포함. 예약일자 오름차순.
export async function getMerchantReservationBatches(
  userId: string,
): Promise<MerchantReservationListItem[]> {
  const today = kstToday();
  const batches = await prisma.reservationBatch.findMany({
    // 픽업이 상품별이므로: 아직 픽업 안 지난 활성 상품이 하나라도 있는 배치만 노출.
    where: { active: true, products: { some: { active: true, pickupDate: { gte: today } } } },
    orderBy: { reserveDate: "asc" },
    select: {
      id: true,
      reserveDate: true,
      // 미래 픽업 상품만(지난 픽업 상품은 목록 픽업일 표시에서 제외)
      products: { where: { active: true, pickupDate: { gte: today } }, select: { pickupDate: true } },
      orders: {
        where: { userId },
        select: { confirmed: true, items: { select: { qty: true } } },
      },
    },
  });
  const list = batches.map((b) => {
    const order = b.orders[0] ?? null;
    return {
      id: b.id,
      reserveDate: b.reserveDate,
      pickupDates: distinctPickups(b.products),
      productCount: b.products.length,
      confirmed: order?.confirmed ?? false,
      reservedQty: order ? order.items.reduce((s, i) => s + i.qty, 0) : 0,
    };
  });
  // 예약일이 얼마 안 남은 순(예약일 빠른 순) → 멀수록 아래. 단 이미 마감된 예약은 맨 아래로.
  list.sort((a, b) => {
    const ca = isReservationClosed(a.reserveDate) ? 1 : 0;
    const cb = isReservationClosed(b.reserveDate) ? 1 : 0;
    if (ca !== cb) return ca - cb; // 열린 예약을 위로
    return a.reserveDate.localeCompare(b.reserveDate); // 예약일 빠른 순
  });
  return list;
}

export type MerchantReservationDetail = {
  id: string;
  reserveDate: string;
  pickupDates: string[];
  products: ReservationProductRow[];
  confirmed: boolean;
  qtyByProduct: Record<string, number>;
};

export async function getMerchantReservation(
  batchId: string,
  userId: string,
): Promise<MerchantReservationDetail | null> {
  const b = await prisma.reservationBatch.findFirst({
    where: { id: batchId, active: true },
    select: {
      id: true,
      reserveDate: true,
      products: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, supplyPrice: true, pickupDate: true, inventoryItemId: true },
      },
      orders: {
        where: { userId },
        select: { confirmed: true, items: { select: { productId: true, qty: true } } },
      },
    },
  });
  if (!b) return null;
  const order = b.orders[0] ?? null;
  const qtyByProduct: Record<string, number> = {};
  for (const it of order?.items ?? []) qtyByProduct[it.productId] = it.qty;
  return {
    id: b.id,
    reserveDate: b.reserveDate,
    pickupDates: distinctPickups(b.products),
    products: b.products,
    confirmed: order?.confirmed ?? false,
    qtyByProduct,
  };
}

// 관리자: 이 배치에서 확정한 점주별 요약(수량·금액 + 상품별 내역) — 배치 페이지 표시용.
export type BatchConfirmation = {
  userId: string;
  storeName: string;
  qty: number;
  total: number;
  items: { name: string; qty: number }[]; // 어떤 상품을 몇 개(펼쳐 보기용)
};
export async function getBatchConfirmations(batchId: string): Promise<BatchConfirmation[]> {
  const orders = await prisma.reservationOrder.findMany({
    where: { batchId, confirmed: true },
    select: {
      userId: true,
      user: { select: { storeName: true } },
      items: {
        where: { qty: { gt: 0 } },
        orderBy: { sortOrder: "asc" },
        select: { name: true, qty: true, supplyPrice: true },
      },
    },
  });
  return orders
    .map((o) => ({
      userId: o.userId,
      storeName: o.user.storeName,
      qty: o.items.reduce((s, i) => s + i.qty, 0),
      total: o.items.reduce((s, i) => s + i.qty * i.supplyPrice, 0),
      items: o.items.map((i) => ({ name: i.name, qty: i.qty })),
    }))
    .filter((o) => o.qty > 0)
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
}

// 계산서용 — 이 발주일(orderDay)에 로드되는 확정 예약분(이름·수량·점주공급가). 일반 계산서 공구에 자동 채움.
// 픽업이 상품별이므로 배치가 아닌 '아이템 픽업일'(스냅샷)이 발주일+1인 확정 아이템만 모은다.
export async function getReservationInvoiceItems(
  userId: string,
  orderDayKst: string,
): Promise<{ name: string; qty: number; supplyPrice: number }[]> {
  const pickupDate = shiftDate(orderDayKst, 1);
  const items = await prisma.reservationOrderItem.findMany({
    where: {
      pickupDate,
      qty: { gt: 0 },
      // 확정(예약 확정)한 예약분만 공구/계산서에 로드 — 연동·수기 모두 동일 게이트.
      order: { userId, confirmed: true, batch: { active: true } },
    },
    select: { name: true, qty: true, supplyPrice: true },
    orderBy: { sortOrder: "asc" },
  });
  // 같은 품목명은 수량 합산(공급가는 처음 값 유지)
  const merged = new Map<string, { name: string; qty: number; supplyPrice: number }>();
  for (const it of items) {
    const key = it.name.trim();
    const cur = merged.get(key);
    if (cur) cur.qty += it.qty;
    else merged.set(key, { name: it.name, qty: it.qty, supplyPrice: it.supplyPrice });
  }
  return [...merged.values()];
}

// 픽업 전날(=오늘 발주창) 공구에 읽기전용으로 로드할 '확정 예약' 항목. 단일출처(주문 복제 X).
// 상품별 픽업이므로 아이템 픽업일(스냅샷)이 발주일+1인 것만. 다른 배치·다른 예약일자여도 합쳐진다.
export type ReservationLoadItem = { name: string; qty: number };
export async function getReservationLoadForOrder(
  userId: string,
  orderDayKst: string,
): Promise<ReservationLoadItem[]> {
  const pickupDate = shiftDate(orderDayKst, 1); // 로드일 == 픽업 전날 ⇒ 픽업 == 발주일+1
  const items = await prisma.reservationOrderItem.findMany({
    where: {
      pickupDate,
      qty: { gt: 0 },
      // 확정한 예약분만 공구에 자동 로드 — 연동·수기 모두 동일 게이트(예약 확정 시 로드·잠금).
      order: { userId, confirmed: true, batch: { active: true } },
    },
    select: { name: true, qty: true },
    orderBy: { sortOrder: "asc" },
  });
  const merged = new Map<string, number>();
  for (const it of items) merged.set(it.name, (merged.get(it.name) ?? 0) + it.qty);
  return [...merged.entries()].map(([name, qty]) => ({ name, qty }));
}

