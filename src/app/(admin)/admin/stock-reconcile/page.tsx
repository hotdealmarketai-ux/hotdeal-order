import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { computeToolReconcile } from "@/app/actions/stock-reconcile";
import { StockReconcileForm } from "@/components/StockReconcileForm";
import { normalizeDateStr } from "@/lib/date";

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

        <StockReconcileForm
          date={date}
          matched={matched}
          unmatched={unmatched}
          undeducted={undeductedCount}
        />
      </div>
    </>
  );
}
