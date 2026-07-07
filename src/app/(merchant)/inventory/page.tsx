import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { canViewInventory } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { formatKStamp } from "@/lib/format";

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
      <Topbar title="재고현황" />
      <div className="page">
        <h1 className="h1">재고현황</h1>
        <p
          className="lead"
          style={{ marginTop: 6, marginBottom: 24, fontSize: 13.5 }}
        >
          재고는 실시간 반영이 되지 않으므로, 실제와 다를 수 있습니다.
        </p>

        {items.length === 0 ? (
          <div className="empty">
            <p>아직 등록된 재고가 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {items.map((it) => (
              <div className="row" key={it.id}>
                <div className="row__main">
                  <div className="row__title">{it.name}</div>
                  {it.memo && <div className="row__sub">{it.memo}</div>}
                  <div
                    className="row__sub"
                    style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 3 }}
                  >
                    업데이트 시간 : {formatKStamp(it.updatedAt)}
                  </div>
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
