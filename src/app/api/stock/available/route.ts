import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { heldByItem, myHolds } from "@/lib/stock-hold";
import { prisma } from "@/lib/prisma";
import { kstToday } from "@/lib/date";

// 재고 남은수량 실시간 폴링 소스 — 남은수량 뜨는 모든 화면이 짧은 주기로 이걸 읽어 갱신.
// available = 기준재고 − 전체 담기(모든 가맹점). mine = 내 담기. 모두 '현재 발주창(오늘)' 기준.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "MERCHANT_HOTDEAL") {
    return NextResponse.json({ available: {}, mine: {} });
  }
  const date = kstToday();
  const [held, items, mine] = await Promise.all([
    heldByItem(date),
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, qty: true },
    }),
    myHolds(user.id, date),
  ]);
  const available: Record<string, number> = {};
  for (const it of items) {
    available[it.id] = Math.max(0, it.qty - (held[it.id] ?? 0));
  }
  const mineMap: Record<string, number> = {};
  for (const h of mine) mineMap[h.itemId] = h.qty;

  return NextResponse.json(
    { available, mine: mineMap },
    { headers: { "Cache-Control": "no-store" } },
  );
}
