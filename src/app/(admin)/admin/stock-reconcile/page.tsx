import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import {
  computeToolReconcile,
  computeSadadreamShipments,
  computeWeeklyReconcile,
} from "@/app/actions/stock-reconcile";
import { StockReconcileForm } from "@/components/StockReconcileForm";
import { normalizeDateStr } from "@/lib/date";
import { WEEKLY_CATEGORIES, boxWord } from "@/lib/weekly-catalog";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 재고 마감 = 계산서(실제 출고) 기준 공구 '총 출고량(=총 차감량)' 집계. 재고는 계산서 발행 시 자동 차감되며,
// 이 페이지에서 품목별 총 출고량을 확인하고(기본 잠금) 필요 시 수량을 수정한다. 재고현황에 없는 품목은 따로 표시.
export default async function StockReconcilePage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const { matched, unmatched, invoiceCount, undeductedCount } =
    await computeToolReconcile(date);
  const weekly = await computeWeeklyReconcile(date);
  const sadadream = await computeSadadreamShipments(date);
  const totalDeducted = matched.reduce((n, r) => n + r.deducted, 0);

  return (
    <>
      <Topbar backHref="/admin" title="재고 마감" />
      <div className="page">
        <form
          method="get"
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}
        >
          <span className="row__sub">출고일</span>
          <input
            className="input input--compact"
            type="date"
            name="date"
            defaultValue={date}
            style={{ width: "auto" }}
          />
          <button className="btn btn--soft btn--sm" type="submit">
            보기
          </button>
        </form>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread">
            <span className="row__sub">
              계산서 발행 {invoiceCount}건 · 차감 품목 {matched.length}개
              {undeductedCount > 0 ? ` · 미차감 ${undeductedCount}건` : ""}
            </span>
            <b>총 {fmt(totalDeducted)}개</b>
          </div>
        </div>

        <Link
          href={`/admin/stock-reconcile/diff?date=${date}`}
          className="btn btn--soft btn--block"
          style={{ marginBottom: 16 }}
        >
          발주↔출고 대조 — 재고 튄 품목 찾기
        </Link>

        <StockReconcileForm
          date={date}
          matched={matched}
          unmatched={unmatched}
          undeducted={undeductedCount}
        />

        {/* 주간발주 출고 — 참고 집계(재고 미반영). 출고 있는 날만 표시(사다드림과 동일). */}
        {weekly.rows.length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div className="section-label">주간발주 출고</div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {WEEKLY_CATEGORIES.filter((c) =>
                weekly.rows.some((r) => r.category === c.key),
              ).map((c, ci) => (
                <div key={c.key}>
                  <div
                    style={{
                      padding: "8px 14px",
                      background: "var(--line-soft)",
                      fontSize: 12,
                      fontWeight: 800,
                      color: "var(--muted)",
                      borderTop: ci ? "1px solid var(--line)" : "none",
                    }}
                  >
                    {c.label}
                  </div>
                  {weekly.rows
                    .filter((r) => r.category === c.key)
                    .map((r) => (
                      <div
                        key={r.code || r.name}
                        className="spread"
                        style={{
                          padding: "11px 14px",
                          alignItems: "center",
                          borderTop: "1px solid var(--line)",
                        }}
                      >
                        <span style={{ minWidth: 0 }}>
                          <b style={{ fontSize: 14.5 }}>{r.name}</b>
                          <span className="row__sub" style={{ display: "block" }}>
                            {r.boxUnit ? `${r.boxUnit} · ` : ""}
                            {r.storeCount}개 점포
                          </span>
                        </span>
                        <b style={{ whiteSpace: "nowrap" }}>
                          {fmt(r.qty)}
                          {boxWord(r.category)}
                        </b>
                      </div>
                    ))}
                </div>
              ))}
            </div>
            <div className="spread" style={{ marginTop: 8 }}>
              <span className="row__sub">주간발주 총 출고</span>
              <b>
                {fmt(weekly.totalBoxes)}
                <span style={{ fontSize: 12, fontWeight: 600 }}> 박스/판</span>
              </b>
            </div>
          </div>
        )}

        {/* 사다드림 출고 — 참고 집계(재고 미반영). */}
        {sadadream.rows.length > 0 && (
          <div style={{ marginTop: 26 }}>
            <div className="section-label">사다드림 출고</div>
            <div className="card" style={{ padding: 0, overflow: "hidden" }}>
              {sadadream.rows.map((r, i) => (
                <div
                  key={`${r.store} ${r.name}`}
                  className="spread"
                  style={{
                    padding: "11px 14px",
                    alignItems: "center",
                    borderTop: i ? "1px solid var(--line)" : "none",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <b style={{ fontSize: 14.5 }}>{r.name}</b>
                    <span className="row__sub" style={{ display: "block" }}>
                      {r.store}
                    </span>
                  </span>
                  <b style={{ whiteSpace: "nowrap" }}>{fmt(r.qty)}개</b>
                </div>
              ))}
            </div>
            <div className="spread" style={{ marginTop: 8 }}>
              <span className="row__sub">사다드림 총 출고</span>
              <b>{fmt(sadadream.totalQty)}개</b>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
