// 재고 담기원장(StockHold) 서버 helper. 남은수량 = 기준재고 − Σ HELD(현재 발주창).
import { prisma } from "@/lib/prisma";
import { kstToday } from "@/lib/date";
import { isOrderOpen } from "@/lib/deadline";

// 현재 발주창(오늘 KST) 기준, 품목별 보류 합계
export async function heldByItem(
  windowDate: string = kstToday(),
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
  windowDate: string = kstToday(),
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
  windowDate: string = kstToday(),
): Promise<void> {
  const holds = await prisma.stockHold.findMany({
    where: { userId, windowDate },
    select: { itemId: true, qty: true },
  });
  if (holds.length === 0) return;
  await prisma.$transaction([
    ...holds
      .filter((h) => h.qty > 0)
      .map((h) =>
        prisma.inventoryItem.updateMany({
          where: { id: h.itemId },
          data: { qty: { decrement: h.qty } },
        }),
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
// 발주창 열려있으면 '지난 창' 잔여만, 마감됐으면 '오늘 미발주분'까지 해제(발주분은 commit에서 이미 삭제됨).
export async function releaseStaleHolds(): Promise<number> {
  const today = kstToday();
  const where = isOrderOpen()
    ? { windowDate: { lt: today } }
    : { windowDate: { lte: today } };
  const res = await prisma.stockHold.deleteMany({ where });
  return res.count;
}
