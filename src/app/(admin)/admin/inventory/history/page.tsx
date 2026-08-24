import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKDateTime } from "@/lib/format";
import { INV_FIELD_LABEL, TAX_LABEL } from "@/lib/inventory-log";

export const dynamic = "force-dynamic";

const LIMIT = 500;

function fmtVal(field: string, v: string): string {
  if (v === "") return "—";
  if (field === "tax") return TAX_LABEL[v] ?? v;
  if (field === "supplyPrice") {
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toLocaleString("ko-KR")}원` : v;
  }
  if (field === "qty") {
    const n = Number(v);
    return Number.isFinite(n) ? `${n.toLocaleString("ko-KR")}개` : v;
  }
  return v;
}

// 재고 변경 기록 — 재고현황 품목 값(이름·수량·유통기한·공급가·과세 등)이 수기 편집으로 바뀔 때마다
// 남긴 필드별 before→after 감사 로그. 실수로 바뀐 값을 추적한다.
export default async function InventoryHistoryPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q: qRaw } = await props.searchParams;
  const q = (qRaw ?? "").trim();

  const logs = await prisma.inventoryChangeLog.findMany({
    where: q ? { itemName: { contains: q } } : undefined,
    orderBy: { createdAt: "desc" },
    take: LIMIT,
  });

  // KST 날짜별 그룹
  const groups: { date: string; rows: typeof logs }[] = [];
  const idxByDate = new Map<string, number>();
  for (const l of logs) {
    const kst = new Date(l.createdAt.getTime() + 9 * 3600 * 1000);
    const date = kst.toISOString().slice(0, 10);
    let gi = idxByDate.get(date);
    if (gi === undefined) {
      gi = groups.length;
      idxByDate.set(date, gi);
      groups.push({ date, rows: [] as unknown as typeof logs });
    }
    groups[gi].rows.push(l);
  }
  const fmtDate = (d: string) => {
    const [, m, dd] = d.split("-");
    return m && dd ? `${Number(m)}월 ${Number(dd)}일` : d;
  };

  return (
    <>
      <Topbar backHref="/admin/inventory" title="재고 변경 기록" />
      <div className="page">
        <form
          method="get"
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}
        >
          <input
            className="input input--compact"
            type="text"
            name="q"
            defaultValue={q}
            placeholder="품목명 검색"
            style={{ flex: 1 }}
          />
          <button className="btn btn--soft btn--sm" type="submit">
            검색
          </button>
        </form>

        {logs.length === 0 ? (
          <div className="card" style={{ textAlign: "center", color: "var(--muted)", padding: 22 }}>
            {q ? `'${q}' 변경 기록이 없어요.` : "아직 변경 기록이 없어요."}
          </div>
        ) : (
          groups.map((g) => (
            <div key={g.date} style={{ marginBottom: 18 }}>
              <div className="section-label">{fmtDate(g.date)}</div>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                {g.rows.map((l, i) => {
                  const isDel = l.kind === "delete";
                  const isNew = l.kind === "create";
                  const label = INV_FIELD_LABEL[l.field] ?? l.field;
                  const badgeColor = isDel
                    ? "var(--danger)"
                    : isNew
                      ? "var(--green-700)"
                      : "var(--fg-2)";
                  const badgeBg = isDel
                    ? "var(--danger-bg)"
                    : isNew
                      ? "var(--green-100)"
                      : "var(--line-soft)";
                  return (
                    <div
                      key={l.id}
                      style={{
                        padding: "11px 14px",
                        borderTop: i ? "1px solid var(--line)" : "none",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 800,
                            color: badgeColor,
                            background: badgeBg,
                            borderRadius: 6,
                            padding: "2px 7px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {label}
                        </span>
                        <b style={{ fontSize: 14, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {l.itemName}
                        </b>
                      </div>
                      <div style={{ fontSize: 13.5, marginTop: 6, fontVariantNumeric: "tabular-nums" }}>
                        {isNew ? (
                          <span style={{ color: "var(--green-700)", fontWeight: 700 }}>{l.after}</span>
                        ) : isDel ? (
                          <span style={{ color: "var(--danger)", fontWeight: 700 }}>
                            삭제됨 · {l.before}
                          </span>
                        ) : (
                          <>
                            <span style={{ color: "var(--muted)" }}>{fmtVal(l.field, l.before)}</span>
                            <span style={{ color: "var(--muted-2)", margin: "0 6px" }}>→</span>
                            <b>{fmtVal(l.field, l.after)}</b>
                          </>
                        )}
                      </div>
                      <div className="row__sub" style={{ marginTop: 4 }}>
                        {formatKDateTime(l.createdAt)}
                        {l.source ? ` · ${l.source}` : ""}
                        {l.actorName ? ` · ${l.actorName}` : ""}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}

        {logs.length >= LIMIT && (
          <p className="row__sub" style={{ marginTop: 8 }}>
            최근 {LIMIT.toLocaleString("ko-KR")}건만 표시했어요. 특정 품목은 위 검색으로 찾아보세요.
          </p>
        )}
      </div>
    </>
  );
}
