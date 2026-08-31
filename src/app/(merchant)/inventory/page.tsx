import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { canViewInventory } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { lockedInventoryItemIds } from "@/lib/reservation-stock";
import { MerchantInventoryList } from "@/components/MerchantInventoryList";

// 재고현황 — 앱 기준(단방향 시트 미러). 열람 전용.
// 공구=예약발주 단일 소스 전환으로 '담기'는 폐지 → 여기선 재고를 보기만 한다(공구는 예약발주에서).
export default async function InventoryPage() {
  const user = await requireMerchant();
  if (!canViewInventory(user.role)) redirect("/order");

  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  // 예약발주에 잡힌(연동) 품목은 '예약발주 진행 중'으로 표시(정보용).
  const lockedIds = await lockedInventoryItemIds();

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
              available: Math.max(0, it.qty),
              supplyPrice: it.supplyPrice,
              expiry: it.expiry ?? "",
              majorCat: it.majorCat ?? "",
              minorCat: it.minorCat ?? "",
              locked: lockedIds.has(it.id),
            }))}
            hint="공구는 예약발주에서 담아 주세요."
          />
        )}
      </div>
    </>
  );
}
