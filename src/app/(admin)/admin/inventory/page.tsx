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
            <input name="name" className="input" placeholder="품목명" required />
            <div style={{ display: "flex", gap: 8 }}>
              <input
                name="qty"
                className="input"
                inputMode="numeric"
                placeholder="남은수량"
                style={{ flex: 1 }}
              />
              <input
                name="supplyPrice"
                className="input"
                inputMode="numeric"
                placeholder="공급가(원)"
                style={{ flex: 1 }}
              />
            </div>
            <button className="btn btn--primary">추가하기</button>
          </form>
          <p className="hint" style={{ marginTop: 8 }}>
            구글시트 연동 시 시트가 기준이에요. 시트를 쓰면 이 화면 대신 시트에서
            수정해 주세요.
          </p>
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
                    name="qty"
                    className="input"
                    inputMode="numeric"
                    defaultValue={it.qty || ""}
                    placeholder="남은수량"
                    style={{ flex: 1 }}
                  />
                  <input
                    name="supplyPrice"
                    className="input"
                    inputMode="numeric"
                    defaultValue={it.supplyPrice || ""}
                    placeholder="공급가"
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
