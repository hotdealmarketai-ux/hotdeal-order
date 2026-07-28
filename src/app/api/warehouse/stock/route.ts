import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// 창고관리 실시간 재고 — 재고현황(InventoryItem.qty, 관리자 기준재고)을 그대로 폴링 소스로.
// 창고 박스/팔레트의 '남은 수량'이 재고현황과 실시간으로 같이 바뀌게 한다. 0이면 품절.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || (user.role !== "WAREHOUSE" && user.role !== "ADMIN_SAEROP")) {
    return NextResponse.json({ qty: {} }, { headers: { "Cache-Control": "no-store" } });
  }
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, qty: true },
  });
  const qty: Record<string, number> = {};
  for (const it of items) qty[it.id] = it.qty;
  return NextResponse.json({ qty }, { headers: { "Cache-Control": "no-store" } });
}
