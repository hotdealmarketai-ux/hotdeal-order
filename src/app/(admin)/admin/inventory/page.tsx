import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { addInventoryAction } from "@/app/actions/admin";
import { InventoryEditor } from "@/components/InventoryEditor";
import { InventoryBulkImport } from "@/components/InventoryBulkImport";

export default async function AdminInventory() {
  await requireAdmin();
  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
  // 품목 추가/삭제로 목록 구성이 바뀌면 편집기를 새로 그린다(입력 중에는 유지).
  const idsKey = items.map((i) => i.id).join(",");

  return (
    <>
      <Topbar backHref="/admin" title="재고현황 작성" />
      <div className="page">
        <InventoryBulkImport currentNames={items.map((it) => it.name)} />

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

        <div className="section-label">등록된 재고</div>
        <InventoryEditor
          key={idsKey}
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
