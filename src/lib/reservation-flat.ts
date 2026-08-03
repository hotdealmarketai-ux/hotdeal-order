// 예약발주 재구조화 — 신규 '단일 목록' 방식(상품별 마감 closeAt). prisma read/헬퍼.
// 날짜 뎁스(ReservationBatch reserveDate) 대신 상품별 closeAt 이 마감을 결정.
// 신규 상품은 모두 상시(evergreen) 배치 하나에 모은다(reserveDate 센티널). 레거시 배치와 분리.
import { prisma } from "@/lib/prisma";

// 신규 flat 상품을 담는 상시 배치의 예약일자 센티널(정렬/마감에 안 쓰임).
export const FLAT_RESERVE_KEY = "__flat__";

// 상시 배치 id 확보(없으면 생성). 신규 상품/주문이 여기 붙는다.
export async function getOrCreateFlatBatchId(): Promise<string> {
  const found = await prisma.reservationBatch.findUnique({
    where: { reserveDate: FLAT_RESERVE_KEY },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.reservationBatch.create({
    data: { reserveDate: FLAT_RESERVE_KEY, pickupDate: FLAT_RESERVE_KEY, active: true },
    select: { id: true },
  });
  return created.id;
}

export type FlatProductRow = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  inventoryItemId: string;
  closeAt: Date;
  totalQty: number; // 취합 수량(전 점포 합)
  storeCount: number; // 예약 점포 수
};

// 관리자 flat 상품 목록. scope "open"=마감 전(마감 임박순), "closed"=마감 후(최근 마감순).
export async function listFlatProductsAdmin(
  scope: "open" | "closed",
  now: Date = new Date(),
): Promise<FlatProductRow[]> {
  const products = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      closeAt: scope === "open" ? { gt: now } : { lte: now },
    },
    orderBy: { closeAt: scope === "open" ? "asc" : "desc" },
    select: {
      id: true,
      name: true,
      pickupDate: true,
      supplyPrice: true,
      inventoryItemId: true,
      closeAt: true,
    },
  });
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);
  const items = await prisma.reservationOrderItem.findMany({
    where: {
      productId: { in: ids },
      qty: { gt: 0 },
      // 확정분만 집계 — 연동 상품의 '담기만 하고 미확정'인 홀드는 공구/계산서로 안 나가고 마감 후 해제되므로
      // '총 N개 · 점포'가 움직이는 값이 되지 않도록(= 실제 발주될 수량과 일치).
      confirmedAt: { not: null },
      order: { batch: { active: true } },
    },
    select: { productId: true, qty: true, order: { select: { userId: true } } },
  });
  const agg = new Map<string, { qty: number; stores: Set<string> }>();
  for (const it of items) {
    const a = agg.get(it.productId) ?? { qty: 0, stores: new Set<string>() };
    a.qty += it.qty;
    a.stores.add(it.order.userId);
    agg.set(it.productId, a);
  }

  const rows = products.map((p) => {
    const a = agg.get(p.id);
    return {
      id: p.id,
      name: p.name,
      pickupDate: p.pickupDate,
      supplyPrice: p.supplyPrice,
      inventoryItemId: p.inventoryItemId,
      closeAt: p.closeAt as Date,
      totalQty: a?.qty ?? 0,
      storeCount: a?.stores.size ?? 0,
    };
  });
  // 정렬: ①마감 임박순(closeAt) ②같은 마감시각이면 ㄱㄴㄷ(이름). DB 콜레이션 대신 JS localeCompare로 한글 순서 보장.
  rows.sort((a, b) => {
    const ca = a.closeAt.getTime();
    const cb = b.closeAt.getTime();
    if (ca !== cb) return scope === "open" ? ca - cb : cb - ca;
    return a.name.localeCompare(b.name, "ko");
  });
  return rows;
}

export type FlatMerchantRow = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  inventoryItemId: string;
  closeAtMs: number;
  myQty: number; // 내가 예약한 수량
  myConfirmed: boolean; // 품목별 확정(confirmedAt) 여부
  available: number; // 재고연동 상품의 남은수량(수기는 무시)
};

// 점주 flat 상품 목록. scope "open"=마감 전(임박순), "closed"=마감 후. 재고연동 상품은 남은수량 시드.
export async function listFlatProductsMerchant(
  userId: string,
  scope: "open" | "closed",
  now: Date = new Date(),
): Promise<FlatMerchantRow[]> {
  const { availableForReservationProducts } = await import("@/lib/reservation-stock");
  const products = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      closeAt: scope === "open" ? { gt: now } : { lte: now },
    },
    orderBy: { closeAt: scope === "open" ? "asc" : "desc" },
    select: {
      id: true,
      name: true,
      pickupDate: true,
      supplyPrice: true,
      inventoryItemId: true,
      closeAt: true,
    },
  });
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);
  const [mine, availMap] = await Promise.all([
    prisma.reservationOrderItem.findMany({
      where: { productId: { in: ids }, order: { userId } },
      select: { productId: true, qty: true, confirmedAt: true },
    }),
    availableForReservationProducts(
      products
        .filter((p) => p.inventoryItemId)
        .map((p) => ({ id: p.id, inventoryItemId: p.inventoryItemId })),
    ),
  ]);
  const myMap = new Map(mine.map((i) => [i.productId, i]));

  const rows = products.map((p) => {
    const m = myMap.get(p.id);
    const myQty = m?.qty ?? 0;
    return {
      id: p.id,
      name: p.name,
      pickupDate: p.pickupDate,
      supplyPrice: p.supplyPrice,
      inventoryItemId: p.inventoryItemId,
      closeAtMs: (p.closeAt as Date).getTime(),
      myQty,
      myConfirmed: !!m?.confirmedAt,
      // 재고연동: 표시용 남은수량 = 전체가용 + 내가 이미 담은 만큼(내 수량은 내가 줄일 수 있으니 더함)
      available: p.inventoryItemId ? (availMap[p.id] ?? 0) + myQty : 0,
    };
  });
  // 정렬: ①마감 임박순(closeAtMs) ②같은 마감시각이면 ㄱㄴㄷ(이름). JS localeCompare로 한글 순서 보장.
  rows.sort((a, b) => {
    if (a.closeAtMs !== b.closeAtMs) {
      return scope === "open" ? a.closeAtMs - b.closeAtMs : b.closeAtMs - a.closeAtMs;
    }
    return a.name.localeCompare(b.name, "ko");
  });
  return rows;
}

// 관리자 상품 상세 — 이 상품을 예약한 점포별 수량(수정용).
export type FlatStoreRow = {
  userId: string;
  storeName: string;
  itemId: string;
  qty: number;
  inventoryItemId: string;
  stockDeducted: boolean;
};
export async function flatProductStores(productId: string): Promise<{
  product: { id: string; name: string; pickupDate: string; supplyPrice: number; inventoryItemId: string; closeAtMs: number } | null;
  stores: FlatStoreRow[];
}> {
  const product = await prisma.reservationProduct.findFirst({
    where: { id: productId, closeAt: { not: null } },
    select: { id: true, name: true, pickupDate: true, supplyPrice: true, inventoryItemId: true, closeAt: true },
  });
  if (!product) return { product: null, stores: [] };
  const items = await prisma.reservationOrderItem.findMany({
    // 확정분만 — 점포별 상세/편집은 실제 발주된(확정) 예약만 보여준다(미확정 담기는 제외).
    where: { productId, confirmedAt: { not: null }, order: { batch: { active: true } } },
    select: {
      id: true,
      qty: true,
      inventoryItemId: true,
      stockDeductedAt: true,
      order: { select: { userId: true, user: { select: { storeName: true } } } },
    },
  });
  const stores: FlatStoreRow[] = items
    .filter((it) => it.qty > 0)
    .map((it) => ({
      userId: it.order.userId,
      storeName: it.order.user.storeName,
      itemId: it.id,
      qty: it.qty,
      inventoryItemId: it.inventoryItemId,
      stockDeducted: !!it.stockDeductedAt,
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
  return {
    product: {
      id: product.id,
      name: product.name,
      pickupDate: product.pickupDate,
      supplyPrice: product.supplyPrice,
      inventoryItemId: product.inventoryItemId,
      closeAtMs: (product.closeAt as Date).getTime(),
    },
    stores,
  };
}

// 마감된 flat 재고연동 상품의 '미확정' 홀드를 해제(삭제).
// 재고연동 담기는 즉시 재고를 홀드(stockDeductedAt:null 로 가용에서 빠짐)하는데,
// 발주 확정을 안 한 채 상품이 마감되면 그 홀드가 계산서로 차감되지도 해제되지도 않아
// 같은 재고품목의 다른 발주·재고현황 가용을 영구히 갉아먹는다 → 마감 후 정리.
export async function releaseClosedFlatHolds(now: Date = new Date()): Promise<number> {
  const closed = await prisma.reservationProduct.findMany({
    where: { closeAt: { not: null, lte: now }, inventoryItemId: { not: "" } },
    select: { id: true },
  });
  if (closed.length === 0) return 0;
  const ids = closed.map((p) => p.id);
  const res = await prisma.reservationOrderItem.deleteMany({
    where: {
      productId: { in: ids },
      confirmedAt: null, // 확정분은 계산서로 차감되므로 건드리지 않음
      qty: { gt: 0 },
      stockDeductedAt: null,
      inventoryItemId: { not: "" },
    },
  });
  return res.count;
}

// 남은 시간 라벨 "N시간 M분 S초 남음" / "마감". 서버 SSR 시드용(클라가 1초 갱신).
export function closeRemainLabel(closeAt: Date, now: number = Date.now()): string {
  let s = Math.floor((closeAt.getTime() - now) / 1000);
  if (s <= 0) return "마감";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d}일 ${h}시간 남음`;
  return `${h}시간 ${m}분 ${s}초 남음`;
}
