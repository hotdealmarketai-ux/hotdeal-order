import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { canViewInventory } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { formatKStamp } from "@/lib/format";
import { lastInventorySyncAt } from "@/lib/inventory-sheet";

const won = (n: number) => n.toLocaleString("ko-KR");

// 재고현황 — 구글시트(품목/남은수량/공급가)를 1분마다 동기화(#12). 시트가 기준.
export default async function InventoryPage() {
  const user = await requireMerchant();
  if (!canViewInventory(user.role)) redirect("/order");

  const [items, syncedAt] = await Promise.all([
    prisma.inventoryItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    lastInventorySyncAt(),
  ]);

  return (
    <>
      <Topbar title="재고현황" />
      <div className="page">
        <p className="hint" style={{ marginTop: 6, marginBottom: 16 }}>
          동기화 시간 : {syncedAt ? formatKStamp(syncedAt) : "동기화 전"}
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
                  {it.supplyPrice > 0 && (
                    <div className="row__sub">개당 {won(it.supplyPrice)}원</div>
                  )}
                  {it.memo && <div className="row__sub">{it.memo}</div>}
                </div>
                <span
                  className={`badge ${
                    it.qty <= 0
                      ? "badge--danger"
                      : it.qty < 5
                        ? "badge--wait"
                        : "badge--ok"
                  }`}
                >
                  {it.qty <= 0 ? "품절" : `${it.qty}개`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
