import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { canViewInventory } from "@/lib/constants";
import { hasOrderWindow, currentWindowStartUtc } from "@/lib/deadline";
import { orderOpenNow } from "@/lib/order-open";
import { prisma } from "@/lib/prisma";
import { kstToday } from "@/lib/date";
import { heldByItem, myHolds } from "@/lib/stock-hold";
import { MerchantInventoryList } from "@/components/MerchantInventoryList";

// 재고현황 — 앱 기준(단방향 시트 미러, R3). '담기'로 오늘 발주(공구)에 자동 임시저장(#6).
export default async function InventoryPage() {
  const user = await requireMerchant();
  if (!canViewInventory(user.role)) redirect("/order");

  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  // #6 담을 수 있는 조건: 발주 시간(또는 관리자 임시 오픈) + 이번 창에 아직 발주 없음.
  const windowed = hasOrderWindow(user.role);
  let canAdd = await orderOpenNow(user.role);
  if (canAdd && windowed) {
    const since = new Date(currentWindowStartUtc());
    const existing = await prisma.order.findFirst({
      where: { userId: user.id, createdAt: { gte: since }, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) canAdd = false; // 이미 발주함 → 발주창에서 수정
  }
  const today = kstToday();
  // 실시간 남은수량 = 기준재고 − Σ담기(모든 점주, 오늘 발주창). 내 담기 수량도 함께.
  const held = await heldByItem(today);
  const mineRows = await myHolds(user.id, today);
  const mine: Record<string, number> = {};
  for (const h of mineRows) mine[h.itemId] = h.qty;

  return (
    <>
      <Topbar title="재고현황" />
      <div className="page">
        {items.length === 0 ? (
          <div className="empty">
            <p>아직 등록된 재고가 없습니다.</p>
          </div>
        ) : (
          <MerchantInventoryList
            items={items.map((it) => ({
              id: it.id,
              name: it.name,
              available: Math.max(0, it.qty - (held[it.id] ?? 0)),
              mine: mine[it.id] ?? 0,
              supplyPrice: it.supplyPrice,
            }))}
            canAdd={canAdd}
            hint={
              canAdd
                ? "담기를 누르면 오늘 발주에 담깁니다."
                : "발주 시간에만 담을 수 있습니다."
            }
          />
        )}
      </div>
    </>
  );
}
