// 예약발주 ↔ 재고현황 연동 — 파생 헬퍼(prisma). 순수 잠금판정은 아래 시각 함수만.
// 연동 상품 = ReservationProduct.inventoryItemId 가 있는 상품(실물 재고로 진행하는 공동구매).
//  · 재고현황에서 잠긴다(담기 불가) — 활성 배치·상품·픽업 10시 전.
//  · 예약에서 담는 수량이 곧 '홀드' → 남은재고 = base − Σ예약홀드 − Σ일일홀드.
//  · 픽업일 오전 10시가 지나면 파생 조건이 자동으로 풀린다(별도 삭제 크론 불필요). base는 수기 재조정.
import { prisma } from "@/lib/prisma";
import { shiftDate } from "@/lib/date";
import { heldByItem } from "@/lib/stock-hold";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
export const RESERVATION_UNLOCK_HOUR = 10; // 픽업일 오전 10시에 잠금 자동 해제

// '아직 잠긴' 픽업일의 하한(YYYY-MM-DD, 이 값 이상이면 잠김).
//  - 오전 10시 전: 오늘 픽업분도 아직 잠김 → today
//  - 오전 10시 후: 오늘 픽업분은 해제 → today+1
export function minLockedPickupDate(now: number = Date.now()): string {
  const kst = new Date(now + KST_OFFSET_MS);
  const hour = kst.getUTCHours();
  const today = kst.toISOString().slice(0, 10); // now 기준 KST 날짜(hour와 일관)
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
      batch: { active: true },
      // 잠금 = ①픽업이 아직 안 지남(레거시·flat 공통) 또는 ②flat 예약이 아직 열려 있음(closeAt 미래).
      // ②가 없으면 '당일 픽업' flat 상품이 오전 10시 이후 pickupDate 조건에서 빠져(minLockedPickupDate=today+1)
      // 예약이 20시까지 열려 있는데도 일일 담기가 풀려 같은 재고를 이중 배정(초과판매)한다. closeAt은 flat만 non-null.
      OR: [{ pickupDate: { gte } }, { closeAt: { gt: new Date(now) } }],
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
      batch: { active: true },
      // 픽업 대기(레거시·flat) 또는 flat 예약이 열려 있는 동안 잠금 — lockedInventoryItemIds와 동일 규칙.
      // 당일 픽업 flat이 10시 이후 초과판매 나던 구멍을 closeAt 조건으로 막는다.
      OR: [{ pickupDate: { gte: minLockedPickupDate(now) } }, { closeAt: { gt: new Date(now) } }],
    },
    select: { id: true },
  });
  return !!found;
}

// 품목별 예약 홀드 합계(전 점주). = Σ ReservationOrderItem.qty
//  (연동 아이템 · 아직 재고 차감 안 됨(stockDeductedAt null) · 활성 배치). 연동은 즉시 담기(홀드)라 confirmed 무관 전부 집계.
// ⚠ 예전엔 '픽업 10시 전'으로 릴리스했으나, 10시 자동차감을 없애고 '재고 정산(다음날) 차감' 방식으로 바꿈에 따라
//   홀드도 그 시점(stockDeductedAt 설정)에 풀린다 → 판매가능이 base 차감과 어긋나지 않음.
// groupBy 는 관계필터를 못 받아 findMany + JS 합산(예약 아이템 수는 소규모).
export async function reservationHeldByItem(): Promise<Record<string, number>> {
  const rows = await prisma.reservationOrderItem.findMany({
    where: {
      inventoryItemId: { not: "" },
      stockDeductedAt: null,
      qty: { gt: 0 },
      order: { batch: { active: true } },
    },
    select: { inventoryItemId: true, qty: true },
  });
  const m: Record<string, number> = {};
  for (const r of rows) m[r.inventoryItemId] = (m[r.inventoryItemId] ?? 0) + r.qty;
  return m;
}

// 품목별 '확정' 예약 합계(전 점주) — 실제 발주될(공구/계산서로 나갈) 예약분만.
// = reservationHeldByItem 와 같되 확정 게이트(order.confirmed OR item.confirmedAt) 추가.
// ⚠ 부족분(납품처 추가주문) 신호용으로만 쓴다. 판매가능·담기 캡은 미확정 홀드까지 세는 reservationHeldByItem 사용.
export async function reservationConfirmedByItem(): Promise<Record<string, number>> {
  const rows = await prisma.reservationOrderItem.findMany({
    where: {
      inventoryItemId: { not: "" },
      stockDeductedAt: null,
      qty: { gt: 0 },
      order: { batch: { active: true } },
      OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
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
): Promise<Record<string, number>> {
  const linked = products.filter((p) => p.inventoryItemId);
  if (linked.length === 0) return {};
  const itemIds = [...new Set(linked.map((p) => p.inventoryItemId))];
  const [resvHeld, dailyHeld, items] = await Promise.all([
    reservationHeldByItem(),
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

// 픽업 시점(픽업일 오전 10시 지남) 연동 예약분을 기준재고(InventoryItem.qty)에서 실제 차감(1회·멱등).
// 예약홀드는 픽업 10시에 판매가능에서 풀리는데, 그 순간 실물도 출고돼 나가므로 base를 함께 줄여
// 숫자가 다시 튀지 않게 한다(사용자 요청). 실제 출고량이 다르면 관리자가 재고현황에서 수기 보정.
// stockDeductedAt 플래그로 중복 차감 방지 → tick 크론이 매분 호출해도 최초 1회만 차감, 이후 no-op.
export async function deductDuePickupStock(
  now: number = Date.now(),
): Promise<number> {
  const gte = minLockedPickupDate(now); // pickupDate < gte = 픽업일 오전 10시 지남
  const dueItems = await prisma.reservationOrderItem.findMany({
    where: {
      inventoryItemId: { not: "" },
      qty: { gt: 0 },
      stockDeductedAt: null,
      pickupDate: { lt: gte, not: "" },
      order: { confirmed: true, batch: { active: true } },
    },
    select: { id: true, inventoryItemId: true, qty: true },
  });
  if (dueItems.length === 0) return 0;

  // 품목별 차감량 합산
  const byItem = new Map<string, number>();
  for (const it of dueItems)
    byItem.set(it.inventoryItemId, (byItem.get(it.inventoryItemId) ?? 0) + it.qty);

  const ids = [...byItem.keys()];
  const invs = await prisma.inventoryItem.findMany({
    where: { id: { in: ids } },
    select: { id: true, qty: true },
  });
  const at = new Date(now);
  await prisma.$transaction(async (tx) => {
    for (const inv of invs) {
      const dec = byItem.get(inv.id) ?? 0;
      // 음수 방지 — max(0, base − 차감). 실제 출고량 차이는 관리자가 수기 보정.
      await tx.inventoryItem.update({
        where: { id: inv.id },
        data: { qty: Math.max(0, inv.qty - dec) },
      });
    }
    await tx.reservationOrderItem.updateMany({
      where: { id: { in: dueItems.map((i) => i.id) } },
      data: { stockDeductedAt: at },
    });
  });
  return dueItems.length;
}
