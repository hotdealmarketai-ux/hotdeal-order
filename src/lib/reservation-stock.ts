// 예약발주 ↔ 재고현황 연동 — 파생 헬퍼(prisma). 순수 잠금판정은 아래 시각 함수만.
// 연동 상품 = ReservationProduct.inventoryItemId 가 있는 상품(실물 재고로 진행하는 공동구매).
//  · 재고현황에서 잠긴다(담기 불가) — 활성 배치·상품·픽업 10시 전.
//  · 예약에서 담는 수량이 곧 '홀드' → 남은재고 = base − Σ예약홀드 − Σ일일홀드.
//  · 픽업일 오전 10시가 지나면 파생 조건이 자동으로 풀린다(별도 삭제 크론 불필요). base는 수기 재조정.
import { prisma } from "@/lib/prisma";
import { kstToday, shiftDate } from "@/lib/date";
import { heldByItem } from "@/lib/stock-hold";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const RESERVATION_UNLOCK_HOUR = 10; // 픽업일 오전 10시에 잠금 자동 해제

// '아직 잠긴' 픽업일의 하한(YYYY-MM-DD, 이 값 이상이면 잠김).
//  - 오전 10시 전: 오늘 픽업분도 아직 잠김 → today
//  - 오전 10시 후: 오늘 픽업분은 해제 → today+1
export function minLockedPickupDate(now: number = Date.now()): string {
  const kst = new Date(now + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  const today = kstToday();
  return hour >= RESERVATION_UNLOCK_HOUR ? shiftDate(today, 1) : today;
}

// 이 픽업일이 지금 '잠긴 상태(예약 진행 중)'인가 — 픽업 10시 전.
export function reservationLockActiveAt(
  pickupDate: string,
  now: number = Date.now(),
): boolean {
  return !!pickupDate && pickupDate >= minLockedPickupDate(now);
}

// 지금 재고현황에서 잠겨야 할 InventoryItem id 집합.
// = 활성 배치·활성 상품·연동(inventoryItemId 있음)·픽업 10시 전.
export async function lockedInventoryItemIds(
  now: number = Date.now(),
): Promise<Set<string>> {
  const gte = minLockedPickupDate(now);
  const rows = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      inventoryItemId: { not: "" },
      pickupDate: { gte },
      batch: { active: true },
    },
    select: { inventoryItemId: true },
  });
  return new Set(rows.map((r) => r.inventoryItemId).filter(Boolean));
}

// 이 품목 1건이 지금 예약발주에 잠겨 있는가(일일 담기 차단용).
export async function isItemReservationLocked(
  itemId: string,
  now: number = Date.now(),
): Promise<boolean> {
  if (!itemId) return false;
  const found = await prisma.reservationProduct.findFirst({
    where: {
      inventoryItemId: itemId,
      active: true,
      pickupDate: { gte: minLockedPickupDate(now) },
      batch: { active: true },
    },
    select: { id: true },
  });
  return !!found;
}

// 품목별 예약 홀드 합계(전 점주). = Σ ReservationOrderItem.qty
//  (연동 아이템 · 픽업 10시 전 · 활성 배치). 연동은 즉시 담기(홀드)라 confirmed 무관 전부 집계.
// groupBy 는 관계필터를 못 받아 findMany + JS 합산(예약 아이템 수는 소규모).
export async function reservationHeldByItem(
  now: number = Date.now(),
): Promise<Record<string, number>> {
  const gte = minLockedPickupDate(now);
  const rows = await prisma.reservationOrderItem.findMany({
    where: {
      inventoryItemId: { not: "" },
      pickupDate: { gte },
      qty: { gt: 0 },
      order: { batch: { active: true } },
    },
    select: { inventoryItemId: true, qty: true },
  });
  const m: Record<string, number> = {};
  for (const r of rows) m[r.inventoryItemId] = (m[r.inventoryItemId] ?? 0) + r.qty;
  return m;
}

// 연동 상품들의 남은수량(productId → available). available = base − 예약홀드 − 일일홀드.
// (SSR 초기값 — 클라 폴링 useLiveReservationStock 이 이후 실시간 갱신)
export async function availableForReservationProducts(
  products: { id: string; inventoryItemId: string }[],
  now: number = Date.now(),
): Promise<Record<string, number>> {
  const linked = products.filter((p) => p.inventoryItemId);
  if (linked.length === 0) return {};
  const itemIds = [...new Set(linked.map((p) => p.inventoryItemId))];
  const [resvHeld, dailyHeld, items] = await Promise.all([
    reservationHeldByItem(now),
    heldByItem(),
    prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, qty: true },
    }),
  ]);
  const baseById: Record<string, number> = {};
  for (const it of items) baseById[it.id] = it.qty;
  const out: Record<string, number> = {};
  for (const p of linked) {
    const base = baseById[p.inventoryItemId] ?? 0;
    const held =
      (resvHeld[p.inventoryItemId] ?? 0) + (dailyHeld[p.inventoryItemId] ?? 0);
    out[p.id] = Math.max(0, base - held);
  }
  return out;
}
