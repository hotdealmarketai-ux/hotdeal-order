import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { heldByItem } from "@/lib/stock-hold";
import { windowKeyAt } from "@/lib/schedule";

// 창고관리 실시간 재고 — 재고현황이 보여주는 '남은 수량'과 100% 동일해야 한다.
// 재고현황(MerchantInventoryList) = max(0, 기준재고 − Σ담기(현재 발주창)). 그래서 여기서도 같게 계산.
// (base 기준재고 그대로가 아니라, 오늘 담긴/나갈 수량을 뺀 실시간 남은수량) 0이면 품절.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "WAREHOUSE" && user.role !== "ADMIN_SAEROP")) {
    return NextResponse.json({ qty: {} }, { headers: { "Cache-Control": "no-store" } });
  }
  const holdKey = windowKeyAt();
  const [items, held] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, qty: true },
    }),
    heldByItem(holdKey),
  ]);
  const qty: Record<string, number> = {};
  for (const it of items) qty[it.id] = Math.max(0, it.qty - (held[it.id] ?? 0));
  return NextResponse.json({ qty }, { headers: { "Cache-Control": "no-store" } });
}
