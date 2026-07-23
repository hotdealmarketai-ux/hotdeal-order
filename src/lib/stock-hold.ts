// 재고 담기원장(StockHold) 서버 helper. 남은수량 = 기준재고 − Σ HELD(현재 발주창).
import { prisma } from "@/lib/prisma";
import { isOrderOpen } from "@/lib/deadline";
import { windowKeyAt } from "@/lib/schedule";
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

// 발주확정 — 이 점주의 현재 발주창 담기(HELD)만큼 기준재고 차감 + 홀드 삭제(출고 자동 반영).
export async function commitStockHolds(
  userId: string,
  windowDate: string = windowKeyAt(),
): Promise<void> {
  const holds = await prisma.stockHold.findMany({
    where: { userId, windowDate },
    select: { itemId: true, qty: true },
  });
  if (holds.length === 0) return;
  await prisma.$transaction([
    // GREATEST(0, …): 창 중 관리자가 base를 홀드보다 낮춘 경우에도 재고가 음수로 저장되지 않게 바닥 처리.
    ...holds
      .filter((h) => h.qty > 0)
      .map(
        (h) =>
          prisma.$executeRaw`UPDATE "InventoryItem" SET qty = GREATEST(0, qty - ${h.qty}) WHERE id = ${h.itemId}`,
      ),
    prisma.stockHold.deleteMany({ where: { userId, windowDate } }),
  ]);
}

// 발주취소 — 그 주문의 공구(TOOL) 품목만큼 기준재고 복구(이름 매칭, best-effort). 재고조사가 최종 정합.
export async function restoreStockForOrder(orderId: string): Promise<void> {
  const items = await prisma.orderItem.findMany({
    where: { order: { id: orderId, category: "TOOL" } },
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
