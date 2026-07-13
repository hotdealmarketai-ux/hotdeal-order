import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  addInventoryAction,
  updateInventoryAction,
  deleteInventoryAction,
} from "@/app/actions/admin";
import {
  lastInventorySyncAt,
  lastInventoryPushAt,
  inventoryPushPending,
  inventorySyncConfigured,
} from "@/lib/inventory-sheet";
import { InventoryPushButton } from "@/components/InventoryPushButton";
import { formatKStamp } from "@/lib/format";

export default async function AdminInventory() {
  await requireAdmin();
  const [items, syncedAt, pushedAt, pushPending] = await Promise.all([
    prisma.inventoryItem.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    lastInventorySyncAt(),
    lastInventoryPushAt(),
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
            {configured
              ? "구글시트와 양방향 연동 중이에요. 여기서 수정·추가·삭제하면 시트에도 반영되고, 시트에서 고쳐도 앱으로 들어와요."
              : "구글시트 연동이 아직 설정되지 않았어요(관리자 환경변수 필요)."}
          </p>
        </div>

        {configured && (
          <div
            className="card"
            style={pushPending ? { borderColor: "var(--danger)" } : undefined}
          >
            {pushPending && (
              <p
                style={{
                  color: "var(--danger)",
                  fontWeight: 700,
                  fontSize: 13.5,
                  margin: "0 0 6px",
                }}
              >
                ⚠ 최근 변경이 아직 시트에 반영되지 않았어요. 아래 버튼으로 다시
                시도해 주세요.
              </p>
            )}
            <div className="spread" style={{ marginBottom: 8 }}>
              <span className="row__sub" style={{ fontSize: 12, color: "var(--muted-2)" }}>
                시트 → 앱 : {syncedAt ? formatKStamp(syncedAt) : "동기화 전"}
              </span>
              <span className="row__sub" style={{ fontSize: 12, color: "var(--muted-2)" }}>
                앱 → 시트 : {pushedAt ? formatKStamp(pushedAt) : "반영 전"}
              </span>
            </div>
            <InventoryPushButton />
          </div>
        )}

        <div className="section-label">등록된 재고</div>
        {items.length === 0 ? (
          <div className="empty">
            <p>등록된 재고가 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {items.map((it) => (
              <div className="card" key={it.id}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <span
                    className="row__sub"
                    style={{ fontSize: 11.5, color: "var(--muted-2)" }}
                  >
                    업데이트 : {formatKStamp(it.updatedAt)}
                  </span>
                  <form action={deleteInventoryAction}>
                    <input type="hidden" name="id" value={it.id} />
                    <button className="linkbtn linkbtn--danger">삭제</button>
                  </form>
                </div>
                <form action={updateInventoryAction} className="stack" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={it.id} />
                  <input
                    name="name"
                    className="input"
                    defaultValue={it.name}
                    placeholder="품목명"
                  />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <span style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      남은 수량
                    </span>
                    <input
                      name="qty"
                      className="input"
                      inputMode="numeric"
                      defaultValue={it.qty || ""}
                      placeholder="수량"
                      style={{ flex: 1 }}
                    />
                    <span style={{ fontSize: 13, color: "var(--muted)", whiteSpace: "nowrap" }}>
                      공급가
                    </span>
                    <input
                      name="supplyPrice"
                      className="input"
                      inputMode="numeric"
                      defaultValue={it.supplyPrice || ""}
                      placeholder="원"
                      style={{ flex: 1 }}
                    />
                  </div>
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
