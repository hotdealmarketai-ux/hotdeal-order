import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getWarehouseStockSnapshot } from "@/lib/warehouse-stock";

// 창고관리 '수량' = 진짜 실물재고. 판매가능(base−홀드)이 아니라 재고현황(base)의 스냅샷을 보여준다.
// (출고자가 예약·담기 때문에 품절로 헷갈리지 않게.) 스냅샷은 오전 10시·수동 동기화 때 갱신.
// 스냅샷 없으면(최초) 현재 base를 그대로 준다. 예약/담기 수량은 화면에서 storeFilters로 따로 표시.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN_SAEROP") {
    return NextResponse.json({ qty: {} }, { headers: { "Cache-Control": "no-store" } });
  }
  const [items, snap] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, qty: true },
    }),
    getWarehouseStockSnapshot(),
  ]);
  const qty: Record<string, number> = {};
  for (const it of items) qty[it.id] = snap?.map[it.id] ?? it.qty; // 스냅샷 우선, 없으면 실시간 base
  return NextResponse.json({ qty }, { headers: { "Cache-Control": "no-store" } });
}
