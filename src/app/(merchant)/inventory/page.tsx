import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { canViewInventory } from "@/lib/constants";
import { hasOrderWindow, isOrderOpen, currentWindowStartUtc } from "@/lib/deadline";
import { prisma } from "@/lib/prisma";
import { formatKStamp } from "@/lib/format";
import { kstToday } from "@/lib/date";
import { lastInventorySyncAt } from "@/lib/inventory-sheet";
import { StockCartButton } from "@/components/StockCartButton";

const won = (n: number) => n.toLocaleString("ko-KR");

// 재고현황 — 구글시트 동기화(#12). '담기'로 오늘 발주(공구)에 자동 임시저장(#6).
export default async function InventoryPage() {
  const user = await requireMerchant();
  if (!canViewInventory(user.role)) redirect("/order");

  const [items, syncedAt] = await Promise.all([
    prisma.inventoryItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    lastInventorySyncAt(),
  ]);

  // #6 담을 수 있는 조건: 발주 시간 + 발주창 열림(이번 창에 아직 발주 없음).
  const windowed = hasOrderWindow(user.role);
  let canAdd = !windowed || isOrderOpen();
  if (canAdd && windowed) {
    const since = new Date(currentWindowStartUtc());
    const existing = await prisma.order.findFirst({
      where: { userId: user.id, createdAt: { gte: since }, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) canAdd = false; // 이미 발주함 → 발주창에서 수정
  }
  const today = kstToday();

  return (
    <>
      <Topbar title="재고현황" />
      <div className="page">
        <p className="hint" style={{ marginTop: 6, marginBottom: 6 }}>
          동기화 시간 : {syncedAt ? formatKStamp(syncedAt) : "동기화 전"}
        </p>
        <p className="hint" style={{ marginTop: 0, marginBottom: 16 }}>
          {canAdd
            ? "담기를 누르면 오늘 발주(공구)에 자동으로 담겨요."
            : "발주 시간에 발주창이 열려 있을 때 담을 수 있어요."}
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
                  <div
                    className="row__sub"
                    style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}
                  >
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
                    {it.supplyPrice > 0 && <span>공급가 {won(it.supplyPrice)}원</span>}
                  </div>
                </div>
                <StockCartButton
                  name={it.name}
                  date={today}
                  disabled={!canAdd}
                  qty={it.qty}
                  supplyPrice={it.supplyPrice}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
