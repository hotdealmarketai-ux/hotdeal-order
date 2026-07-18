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

// 관리자: 이 배치에서 확정한 점주별 요약(수량·금액·계산서 발행여부) — 예약 계산서 발행용.
export type BatchConfirmation = {
  userId: string;
  storeName: string;
  qty: number;
  total: number;
  invoiced: boolean;
};
export async function getBatchConfirmations(
  batchId: string,
  pickupDate: string,
): Promise<BatchConfirmation[]> {
  const orders = await prisma.reservationOrder.findMany({
    where: { batchId, confirmed: true },
    select: {
      userId: true,
      user: { select: { storeName: true } },
      items: { select: { qty: true, supplyPrice: true } },
    },
  });
  const userIds = orders.map((o) => o.userId);
  const invoiced = new Set(
    (
      await prisma.invoice.findMany({
        where: {
          userId: { in: userIds },
          date: pickupDate,
          kind: "RESERVATION",
          status: { not: "VOID" },
        },
        select: { userId: true },
      })
    ).map((i) => i.userId),
  );
  return orders
    .map((o) => ({
      userId: o.userId,
      storeName: o.user.storeName,
      qty: o.items.reduce((s, i) => s + i.qty, 0),
      total: o.items.reduce((s, i) => s + i.qty * i.supplyPrice, 0),
      invoiced: invoiced.has(o.userId),
    }))
    .filter((o) => o.qty > 0)
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
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
  const batch = await prisma.reservationBatch.findFirst({
    where: { active: true, pickupDate },
    select: {
      orders: {
        where: { userId, confirmed: true },
        select: { items: { select: { name: true, qty: true }, orderBy: { sortOrder: "asc" } } },
      },
    },
  });
  const items = batch?.orders[0]?.items ?? [];
  return items.filter((i) => i.qty > 0).map((i) => ({ name: i.name, qty: i.qty }));
}

