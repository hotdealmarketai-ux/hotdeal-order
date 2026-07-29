// 재고 담기원장(StockHold) 서버 helper. 남은수량 = 기준재고 − Σ HELD(현재 발주창).
import { prisma } from "@/lib/prisma";
import { isOrderOpen } from "@/lib/deadline";
import { windowKeyAt, currentWindowStartUtc } from "@/lib/schedule";
import { dailyForceOpen } from "@/lib/order-open";

// 현재 발주창 기준, 품목별 보류 합계. windowDate=창키(주말=토요일 하나) — kstToday() 아님.
export async function heldByItem(
  windowDate: string = windowKeyAt(),
): Promise<Record<string, number>> {
  const rows = await prisma.stockHold.groupBy({
    by: ["itemId"],
    where: { windowDate },
    _sum: { qty: true },
  });
  const m: Record<string, number> = {};
  for (const r of rows) m[r.itemId] = r._sum.qty ?? 0;
  return m;
}

// 내(점주)의 현재 발주창 담기 목록 (공구 발주에 넣을 항목 = 이 홀드)
export async function myHolds(
  userId: string,
  windowDate: string = windowKeyAt(),
): Promise<{ itemId: string; name: string; qty: number }[]> {
  return prisma.stockHold.findMany({
    where: { userId, windowDate },
    orderBy: { createdAt: "asc" },
    select: { itemId: true, name: true, qty: true },
  });
}

export function availableOf(baseQty: number, held: number): number {
  return Math.max(0, baseQty - held);
}

// 공구(TOOL) 발주분 기준재고 정산 — 매일 8시 마감 집계/미리보기 적용의 코어.
// 넘겨받은 발주 중 '아직 미차감(stockDeductedAt=null)·취소아님·TOOL'만 대상으로,
// 품목명 매칭으로 재고에서 차감(GREATEST 0)하고 그 발주를 stockDeductedAt로 표시(멱등 = 재실행해도 재차감 안 됨).
export async function deductToolOrders(
  orderIds: string[],
  now: number = Date.now(),
): Promise<number> {
  if (orderIds.length === 0) return 0;
  const orders = await prisma.order.findMany({
    where: {
      id: { in: orderIds },
      category: "TOOL",
      status: { not: "CANCELLED" },
      stockDeductedAt: null,
    },
    select: { id: true, items: { select: { name: true, qty: true } } },
  });
  if (orders.length === 0) return 0;
  // 품목명별 차감 수량 합산(공구 수량은 숫자)
  const byName = new Map<string, number>();
  for (const o of orders)
    for (const it of o.items) {
      const name = it.name.trim();
      const n = parseInt(String(it.qty).replace(/[^\d]/g, ""), 10);
      if (name && Number.isFinite(n) && n > 0)
        byName.set(name, (byName.get(name) ?? 0) + n);
    }
  const at = new Date(now);
  await prisma.$transaction([
    // GREATEST(0, …): 실물보다 많이 나가도 재고가 음수로 저장되지 않게 바닥 처리(차이는 수기 보정).
    ...[...byName.entries()].map(
      ([name, q]) =>
        prisma.$executeRaw`UPDATE "InventoryItem" SET qty = GREATEST(0, qty - ${q}) WHERE name = ${name} AND "deletedAt" IS NULL`,
    ),
    prisma.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { stockDeductedAt: at },
    }),
  ]);
  return orders.length;
}

// 발주취소 — 그 주문의 공구(TOOL) 품목만큼 기준재고 복구(이름 매칭, best-effort).
// ⚠ 이미 '차감된'(stockDeductedAt 있는) 발주만 되돌린다 — 아직 차감 전 발주를 복구하면 재고가 부풀기 때문.
export async function restoreStockForOrder(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { category: true, stockDeductedAt: true },
  });
  if (!order || order.category !== "TOOL" || !order.stockDeductedAt) return; // 미차감분은 복구 안 함
  const items = await prisma.orderItem.findMany({
    where: { orderId },
    select: { name: true, qty: true },
  });
  for (const it of items) {
    const n = parseInt(String(it.qty).replace(/[^\d]/g, ""), 10);
    if (!it.name.trim() || !Number.isFinite(n) || n <= 0) continue;
    await prisma.inventoryItem.updateMany({
      where: { name: it.name, deletedAt: null },
      data: { qty: { increment: n } },
    });
  }
}

// 발주 마감(오후 8시) 정산 — 그 창의 확정 공구 발주분만큼 기준재고 차감(멱등). tick이 매분 호출하지만
// 창이 '열려있으면'(정규/강제) 아무것도 안 하고, 마감 후에만 1회 차감(이미 차감된 발주는 flag로 제외).
export async function deductWindowToolOrders(
  now: number = Date.now(),
): Promise<number> {
  if (isOrderOpen() || (await dailyForceOpen())) return 0; // 마감 전엔 정산 안 함
  const start = new Date(currentWindowStartUtc(now));
  const orders = await prisma.order.findMany({
    where: {
      category: "TOOL",
      status: { not: "CANCELLED" },
      stockDeductedAt: null,
      createdAt: { gte: start },
    },
    select: { id: true },
  });
  return deductToolOrders(orders.map((o) => o.id), now);
}

// 미발주 담기(HELD) 자동 해제 — 재고 복구(base는 안 건드림). 크론에서 주기 호출.
// 창키(windowKeyAt) 기준. 현재 창이 '살아있으면'(정규 오픈 또는 관리자 강제오픈) 지난 창 잔여만,
// 마감됐으면 현재 창 미발주분까지 해제(발주분은 commit에서 이미 삭제됨).
//  → 주말 연속창(토12–일20)이 자정에 안 쪼개지고, 강제오픈 중 담기가 크론에 삭제되지 않는다.
export async function releaseStaleHolds(): Promise<number> {
  const key = windowKeyAt();
  const live = isOrderOpen() || (await dailyForceOpen());
  const where = live
    ? { windowDate: { lt: key } }
    : { windowDate: { lte: key } };
  const res = await prisma.stockHold.deleteMany({ where });
  return res.count;
}
