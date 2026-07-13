import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { addInventoryAction } from "@/app/actions/admin";
import {
  inventoryPushPending,
  inventorySyncConfigured,
} from "@/lib/inventory-sheet";
import { InventoryPushButton } from "@/components/InventoryPushButton";
import { InventoryEditor } from "@/components/InventoryEditor";

export default async function AdminInventory() {
  await requireAdmin();
  const [items, pushPending] = await Promise.all([
    prisma.inventoryItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    inventoryPushPending(),
  ]);
  const configured = inventorySyncConfigured();

  return (
    <>
      <Topbar backHref="/admin" title="재고현황 작성" />
      <div className="page">
        <div className="card">
          <div className="section-label" style={{ margin: "0 0 10px" }}>
            새 품목 추가
          </div>
          <form action={addInventoryAction} className="stack" style={{ gap: 8 }}>
            <input
              name="name"
              className="input input--compact"
              placeholder="품목명"
              required
            />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                name="qty"
                className="input input--compact"
                inputMode="numeric"
                placeholder="남은 수량"
                style={{ flex: 1, minWidth: 0 }}
              />
              <input
                name="supplyPrice"
                className="input input--compact"
                inputMode="numeric"
                placeholder="공급가(원)"
                style={{ flex: 1, minWidth: 0 }}
              />
            </div>
            <button className="btn btn--primary btn--sm">추가하기</button>
          </form>
        </div>

        {/* 시트 반영이 밀렸을 때만(실패) 경고 + 재시도 */}
        {configured && pushPending && (
          <div className="card" style={{ borderColor: "var(--danger)" }}>
            <p
              style={{
                color: "var(--danger)",
                fontWeight: 700,
                fontSize: 13.5,
                margin: "0 0 8px",
              }}
            >
              ⚠ 최근 변경이 아직 시트에 반영되지 않았어요. 아래 버튼으로 다시 시도해 주세요.
            </p>
            <InventoryPushButton />
          </div>
        )}

        <div className="section-label">등록된 재고</div>
        <InventoryEditor
          initial={items.map((it) => ({
            id: it.id,
            name: it.name,
            qty: it.qty ? String(it.qty) : "",
            supplyPrice: it.supplyPrice ? String(it.supplyPrice) : "",
          }))}
        />
      </div>
    </>
  );
}
