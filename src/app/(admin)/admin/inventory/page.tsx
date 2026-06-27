import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  addInventoryAction,
  updateInventoryAction,
  deleteInventoryAction,
} from "@/app/actions/admin";

export default async function AdminInventory() {
  await requireAdmin();
  const items = await prisma.inventoryItem.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return (
    <>
      <header className="topbar">
        <Link href="/admin" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">재고현황 작성</div>
      </header>
      <div className="page">
        <h1 className="h1">재고현황</h1>

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
                <div className="spread" style={{ marginBottom: 10 }}>
                  <div className="row__title">{it.name}</div>
                  <form action={deleteInventoryAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="linkbtn linkbtn--danger">삭제</button>
                  </form>
                </div>
                <form action={updateInventoryAction} className="stack">
                  <input type="hidden" name="id" value={it.id} />
                  <input
                    name="status"
                    className="input"
                    defaultValue={it.status}
                    placeholder="상태/수량"
                  />
                  <button className="btn btn--soft btn--sm" style={{ width: "100%" }}>
                    저장
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
