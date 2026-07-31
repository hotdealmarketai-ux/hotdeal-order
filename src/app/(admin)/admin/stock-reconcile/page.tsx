import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { computeToolReconcile } from "@/app/actions/stock-reconcile";
import { StockReconcileForm } from "@/components/StockReconcileForm";
import { normalizeDateStr } from "@/lib/date";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 재고 정산 = 계산서(실제 출고) 기준 공구 차감 내역. 재고는 계산서 발행 시 자동 차감되며,
// 이 페이지는 그 출고일 발행 계산서의 공구 품목·차감 결과를 보여주고, 미차감분이 있으면 '재고 반영'으로 보정한다.
export default async function StockReconcilePage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const { rows, orderCount, resvCount } = await computeToolReconcile(date);
  const totalOrdered = rows.reduce((n, r) => n + r.ordered, 0);
  const unmatched = rows.filter((r) => !r.matched);

  return (
    <>
      <Topbar backHref="/admin" title="재고 마감" />
      <div className="page">
        <form
          method="get"
          style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14 }}
        >
          <span className="row__sub">출고일</span>
          <input className="input input--compact" type="date" name="date" defaultValue={date} style={{ width: "auto" }} />
          <button className="btn btn--soft btn--sm" type="submit">보기</button>
        </form>

        <div className="card" style={{ marginBottom: 14 }}>
          <div className="spread">
            <span className="row__sub">
              계산서 발행 공구 {orderCount}건
              {resvCount > 0 ? ` · 미차감 ${resvCount}건` : " · 재고 반영 완료"}
            </span>
            <b>총 {fmt(totalOrdered)}개</b>
          </div>
          <div className="row__sub" style={{ marginTop: 6, fontSize: 12.5 }}>
            재고는 계산서 발행 시 자동으로 차감돼요. 아래는 그 내역이며, 혹시 미차감분이 있으면 ‘재고 반영’으로 보정하세요.
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <p>이 출고일에 발행된 계산서 공구가 없어요.</p>
          </div>
        ) : (
          <>
            <StockReconcileForm date={date} rows={rows} />

            {unmatched.length > 0 && (
              <div className="notice notice--mute" style={{ marginTop: 12 }}>
                ‘재고없음’ 품목은 재고현황에 같은 이름이 없어 차감되지 않아요(이름 확인 필요).
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
