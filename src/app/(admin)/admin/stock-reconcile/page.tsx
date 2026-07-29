import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { computeToolReconcile } from "@/app/actions/stock-reconcile";
import { StockReconcileForm } from "@/components/StockReconcileForm";
import { normalizeDateStr, labelDate } from "@/lib/date";

export const dynamic = "force-dynamic";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 재고 정산 — 그 출고일에 나갈 공구(상시 담기) + 예약(재고연동) 발주분을 미리보고 차감량 수정 후 승인.
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
      <Topbar backHref="/admin" title="재고 정산" />
      <div className="page">
        <p className="lead" style={{ marginBottom: 10 }}>
          <b>출고 {labelDate(date)}</b> 에 나갈 <b>공구(상시)</b> + <b>예약(연동)</b> 발주분을
          기준재고에서 정산합니다. <b>발주량</b>을 확인·수정하고 승인하면 그만큼만 빠집니다.
        </p>
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          ⚠ ‘제안재고’가 실제와 맞는지 확인하고 승인하세요. 이미 빠진 품목이 섞이면 이중 차감될 수
          있어요(그 경우 재고현황에서 수기 보정). 예약분은 픽업일 10시 자동 차감과 중복되지 않게
          처리되고, 공구는 매일 오후 8시 마감에 자동 정산됩니다.
        </div>

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
              정산 대상(미차감) — 공구 {orderCount}건 · 예약 {resvCount}건
            </span>
            <b>총 {fmt(totalOrdered)}개</b>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="empty">
            <p>정산할 발주가 없어요. (이미 정산됐거나 발주 없음)</p>
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
