import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { reservationHeldByItem } from "@/lib/reservation-stock";
import { heldByItem } from "@/lib/stock-hold";

// 예약발주 연동 상품 남은수량 실시간 소스(배치 단위). productId 키로 반환.
// available(공개) = 재고 base − 전체 예약홀드 − 일일홀드. mine = 내 예약수량. 클라 maxForMe = available + mine.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "MERCHANT_HOTDEAL") {
    return NextResponse.json({ available: {}, mine: {} });
  }
  const batchId = new URL(request.url).searchParams.get("batchId") ?? "";
  if (!batchId) return NextResponse.json({ available: {}, mine: {} });

  const products = await prisma.reservationProduct.findMany({
    where: { batchId, active: true, inventoryItemId: { not: "" } },
    select: { id: true, inventoryItemId: true },
  });
  if (products.length === 0) return NextResponse.json({ available: {}, mine: {} });

  const itemIds = [...new Set(products.map((p) => p.inventoryItemId))];
  const [resvHeld, dailyHeld, items, myOrder] = await Promise.all([
    reservationHeldByItem(),
    heldByItem(),
    prisma.inventoryItem.findMany({
      where: { id: { in: itemIds } },
      select: { id: true, qty: true },
    }),
    prisma.reservationOrder.findUnique({
      where: { userId_batchId: { userId: user.id, batchId } },
      select: { items: { select: { productId: true, qty: true } } },
    }),
  ]);

  const baseById: Record<string, number> = {};
  for (const it of items) baseById[it.id] = it.qty;
  const mineByProduct: Record<string, number> = {};
  for (const it of myOrder?.items ?? []) mineByProduct[it.productId] = it.qty;

  const available: Record<string, number> = {};
  const mine: Record<string, number> = {};
  for (const p of products) {
    const base = baseById[p.inventoryItemId] ?? 0;
    const held =
      (resvHeld[p.inventoryItemId] ?? 0) + (dailyHeld[p.inventoryItemId] ?? 0);
    available[p.id] = Math.max(0, base - held);
    mine[p.id] = mineByProduct[p.id] ?? 0;
  }
  return NextResponse.json(
    { available, mine },
    { headers: { "Cache-Control": "no-store" } },
  );
}
