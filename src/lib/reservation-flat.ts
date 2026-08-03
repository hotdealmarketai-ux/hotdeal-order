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

  return products.map((p) => {
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
