import { redirect } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { canViewInventory } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

function stockBadgeClass(status: string): string {
  if (status.includes("넉넉") || status.includes("많")) return "badge--ok";
  if (status.includes("부족") || status.includes("없") || status.includes("품절"))
    return "badge--wait";
  return "badge--mute";
}

export default async function InventoryPage() {
  const user = await requireMerchant();
  if (!canViewInventory(user.role)) redirect("/order");

  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <header className="topbar">
        <div className="topbar__title">재고현황</div>
      </header>
      <div className="page">
        <h1 className="h1">재고현황</h1>
        <p className="lead">본사(새롭)가 올린 오늘의 재고예요.</p>

        {items.length === 0 ? (
          <div className="empty">
            <div className="empty__ic">📦</div>
            <p>아직 등록된 재고가 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {items.map((it) => (
              <div className="row" key={it.id}>
                <div className="row__main">
                  <div className="row__title">{it.name}</div>
                  {it.memo && <div className="row__sub">{it.memo}</div>}
                </div>
                {it.status && (
                  <span className={`badge ${stockBadgeClass(it.status)}`}>
                    {it.status}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
