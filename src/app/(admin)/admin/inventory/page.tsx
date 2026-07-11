import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  addInventoryAction,
  updateInventoryAction,
  deleteInventoryAction,
} from "@/app/actions/admin";
import { formatKStamp } from "@/lib/format";

export default async function AdminInventory() {
  await requireAdmin();
  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <Topbar backHref="/admin" title="재고현황 작성" />
      <div className="page">
        <div className="card">
          <div className="section-label" style={{ margin: "0 0 10px" }}>
            새 품목 추가
          </div>
          <form action={addInventoryAction} className="stack">
            <input name="name" className="input" placeholder="품목" required />
            <input name="status" className="input" placeholder="상태/수량" />
            <button className="btn btn--primary">추가하기</button>
          </form>
        </div>

        <div className="section-label">등록된 재고</div>
        {items.length === 0 ? (
          <div className="empty">
            <p>등록된 재고가 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {items.map((it) => (
              <div className="card" key={it.id}>
                <div className="spread" style={{ marginBottom: 4 }}>
                  <div className="row__title">{it.name}</div>
                  <form action={deleteInventoryAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="linkbtn linkbtn--danger">삭제</button>
                  </form>
                </div>
                <div
                  className="row__sub"
                  style={{ fontSize: 11.5, color: "var(--muted-2)", marginBottom: 10 }}
                >
                  업데이트 시간 : {formatKStamp(it.updatedAt)}
                </div>
                <form action={updateInventoryAction} style={{ display: "flex", gap: 8 }}>
                  <input type="hidden" name="id" value={it.id} />
                  <input
                    name="status"
                    className="input"
                    defaultValue={it.status}
                    placeholder="상태/수량"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn--soft btn--sm">저장</button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
