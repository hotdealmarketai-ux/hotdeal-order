// 예약발주 서버 데이터 접근(prisma) — 서버 컴포넌트/액션에서 사용. 순수계산은 lib/reservation.ts.
import { prisma } from "@/lib/prisma";
import { kstToday, shiftDate } from "@/lib/date";

export type ReservationBatchListItem = {
  id: string;
  reserveDate: string;
  pickupDate: string;
  productCount: number;
  orderCount: number;
};

// 관리자 목록 — 활성 배치 + 상품/예약 건수. 예약일자 내림차순.
export async function getReservationBatchesAdmin(): Promise<ReservationBatchListItem[]> {
  const batches = await prisma.reservationBatch.findMany({
    where: { active: true },
    orderBy: { reserveDate: "desc" },
    select: {
      id: true,
      reserveDate: true,
      pickupDate: true,
      _count: { select: { products: { where: { active: true } }, orders: true } },
    },
  });
  return batches.map((b) => ({
    id: b.id,
    reserveDate: b.reserveDate,
    pickupDate: b.pickupDate,
    productCount: b._count.products,
    orderCount: b._count.orders,
  }));
}

export type ReservationProductRow = { id: string; name: string; supplyPrice: number };

export type ReservationBatchDetail = {
  id: string;
  reserveDate: string;
  pickupDate: string;
  products: ReservationProductRow[];
  hasOrders: boolean; // 점주 예약이 하나라도 있으면 날짜 변경 잠금
};

export async function getReservationBatch(id: string): Promise<ReservationBatchDetail | null> {
  const b = await prisma.reservationBatch.findFirst({
    where: { id, active: true },
    select: {
      id: true,
      reserveDate: true,
      pickupDate: true,
      products: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, supplyPrice: true },
      },
      _count: { select: { orders: true } },
    },
  });
  if (!b) return null;
  return {
    id: b.id,
    reserveDate: b.reserveDate,
    pickupDate: b.pickupDate,
    products: b.products,
    hasOrders: b._count.orders > 0,
  };
}

// ── 점주(핫딜마켓) ────────────────────────────────────────────

export type MerchantReservationListItem = {
  id: string;
  reserveDate: string;
  pickupDate: string;
  productCount: number;
  confirmed: boolean;
  reservedQty: number; // 내가 예약한 총 수량
};

// 점주에게 보일 배치 — 활성 + 상품 1개↑ + 픽업 안 지남. 내 예약 상태 포함. 예약일자 오름차순.
export async function getMerchantReservationBatches(
  userId: string,
): Promise<MerchantReservationListItem[]> {
  const today = kstToday();
  const batches = await prisma.reservationBatch.findMany({
    where: { active: true, pickupDate: { gte: today } },
    orderBy: { reserveDate: "asc" },
    select: {
      id: true,
      reserveDate: true,
      pickupDate: true,
      _count: { select: { products: { where: { active: true } } } },
      orders: {
        where: { userId },
        select: { confirmed: true, items: { select: { qty: true } } },
      },
    },
  });
  return batches
    .filter((b) => b._count.products > 0)
    .map((b) => {
      const order = b.orders[0] ?? null;
      return {
        id: b.id,
        reserveDate: b.reserveDate,
        pickupDate: b.pickupDate,
        productCount: b._count.products,
        confirmed: order?.confirmed ?? false,
        reservedQty: order ? order.items.reduce((s, i) => s + i.qty, 0) : 0,
      };
    });
}

export type MerchantReservationDetail = {
  id: string;
  reserveDate: string;
  pickupDate: string;
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
      pickupDate: true,
      products: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: { id: true, name: true, supplyPrice: true },
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
    pickupDate: b.pickupDate,
    products: b.products,
    confirmed: order?.confirmed ?? false,
    qtyByProduct,
  };
}

// 관리자: 이 배치에서 확정한 점주별 요약(수량·금액) — 배치 페이지 정보 표시용.
export type BatchConfirmation = {
  userId: string;
  storeName: string;
  qty: number;
  total: number;
};
export async function getBatchConfirmations(batchId: string): Promise<BatchConfirmation[]> {
  const orders = await prisma.reservationOrder.findMany({
    where: { batchId, confirmed: true },
    select: {
      userId: true,
      user: { select: { storeName: true } },
      items: { select: { qty: true, supplyPrice: true } },
    },
  });
  return orders
    .map((o) => ({
      userId: o.userId,
      storeName: o.user.storeName,
      qty: o.items.reduce((s, i) => s + i.qty, 0),
      total: o.items.reduce((s, i) => s + i.qty * i.supplyPrice, 0),
    }))
    .filter((o) => o.qty > 0)
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
}

// 계산서용 — 이 발주일(orderDay)에 로드되는 확정 예약분(이름·수량·점주공급가). 일반 계산서 공구에 자동 채움.
export async function getReservationInvoiceItems(
  userId: string,
  orderDayKst: string,
): Promise<{ name: string; qty: number; supplyPrice: number }[]> {
  const pickupDate = shiftDate(orderDayKst, 1);
  // 같은 픽업일에 배치가 여러 개일 수 있으므로(오전/오후·품목군 분리) 그 픽업일의 '모든' 활성
  // 배치에서 이 점주의 확정 예약분을 합친다(findFirst는 첫 배치만 잡아 나머지가 조용히 누락됐다).
  const batches = await prisma.reservationBatch.findMany({
    where: { active: true, pickupDate },
    select: {
      orders: {
        where: { userId, confirmed: true },
        select: {
          items: {
            select: { name: true, qty: true, supplyPrice: true },
            orderBy: { sortOrder: "asc" },
          },
        },
      },
    },
  });
  // 같은 품목명은 수량 합산(공급가는 처음 값 유지)
  const merged = new Map<string, { name: string; qty: number; supplyPrice: number }>();
  for (const b of batches)
    for (const o of b.orders)
      for (const it of o.items) {
        if (it.qty <= 0) continue;
        const key = it.name.trim();
        const cur = merged.get(key);
        if (cur) cur.qty += it.qty;
        else merged.set(key, { name: it.name, qty: it.qty, supplyPrice: it.supplyPrice });
      }
  return [...merged.values()];
}

// 픽업 전날(=오늘 발주창) 공구에 읽기전용으로 로드할 '확정 예약' 항목. 단일출처(주문 복제 X).
// 반환: 오늘이 로드일인, 이 점주가 확정한 배치들의 품목·수량.
export type ReservationLoadItem = { name: string; qty: number };
export async function getReservationLoadForOrder(
  userId: string,
  orderDayKst: string,
): Promise<ReservationLoadItem[]> {
  // 로드일 == 픽업 전날  ⇒  픽업일 == 발주일 + 1
  const pickupDate = shiftDate(orderDayKst, 1);
  // 같은 픽업일의 모든 활성 배치에서 이 점주 확정분을 합친다(findFirst는 첫 배치만 잡아 누락됐다).
  const batches = await prisma.reservationBatch.findMany({
    where: { active: true, pickupDate },
    select: {
      orders: {
        where: { userId, confirmed: true },
        select: { items: { select: { name: true, qty: true }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  const merged = new Map<string, number>();
  for (const b of batches)
    for (const o of b.orders)
      for (const it of o.items) {
        if (it.qty <= 0) continue;
        merged.set(it.name, (merged.get(it.name) ?? 0) + it.qty);
      }
  return [...merged.entries()].map(([name, qty]) => ({ name, qty }));
}

