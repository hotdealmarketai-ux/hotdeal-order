import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { heldByItem } from "@/lib/stock-hold";
import { reservationHeldByItem } from "@/lib/reservation-stock";
import { windowKeyAt } from "@/lib/schedule";

// 창고관리 실시간 재고 — 재고현황의 '판매가능'과 동일해야 한다.
// 판매가능 = max(0, 기준재고 − Σ담기(현재 발주창) − Σ예약홀드). 예약홀드는 픽업일 오전 10시 지나면 자동 해제.
// (물방울 츄러스: base 26 − 예약 25 = 판매가능 1)
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "WAREHOUSE" && user.role !== "ADMIN_SAEROP")) {
    return NextResponse.json({ qty: {} }, { headers: { "Cache-Control": "no-store" } });
  }
  const holdKey = windowKeyAt();
  const [items, held, resv] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, qty: true },
    }),
    heldByItem(holdKey),
    reservationHeldByItem(),
  ]);
  const qty: Record<string, number> = {};
  for (const it of items)
    qty[it.id] = Math.max(0, it.qty - (held[it.id] ?? 0) - (resv[it.id] ?? 0));
  return NextResponse.json({ qty }, { headers: { "Cache-Control": "no-store" } });
}
