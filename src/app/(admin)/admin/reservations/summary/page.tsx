import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { flatScopeAggregate, type FlatScope } from "@/lib/reservation-flat";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

const SCOPE_LABEL: Record<FlatScope, string> = {
  open: "현 예약발주",
  closed: "지난 예약 마감",
  pickupClosed: "지난 픽업 마감",
};
const BACK: Record<FlatScope, string> = {
  open: "/admin/reservations",
  closed: "/admin/reservations/closed",
  pickupClosed: "/admin/reservations/pickup-closed",
};

// 예약발주 전체 집계 — scope(현 예약발주/지난 예약 마감/지난 픽업 마감)의 모든 상품을
// '들어온 지점만' 묶어 한 화면에. 발주서(본사출고) 전체 집계와 같은 정리 양식.
export default async function ReservationSummaryPage(props: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requireAdmin();
  const sp = await props.searchParams;
  const scope: FlatScope =
    sp.scope === "closed" || sp.scope === "pickupClosed" ? sp.scope : "open";
  const { products, grandTotal, storeCount } = await flatScopeAggregate(scope);

  return (
    <>
      <Topbar backHref={BACK[scope]} title={`${SCOPE_LABEL[scope]} 집계`} />
      <div className="page">
        <div className="notice notice--ai" style={{ marginBottom: 14 }}>
          상품 {products.length}종 · 전 지점 합계 <b>{grandTotal}개</b> · 발주 지점 {storeCount}곳
        </div>

        {products.length === 0 ? (
          <div className="empty">
            <p>집계할 발주가 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {products.map((p) => (
              <div className="card" key={p.id}>
                <div className="spread" style={{ marginBottom: 8 }}>
                  <div className="receipt__store" style={{ fontSize: 19 }}>
                    {p.name}
                  </div>
                  <span className="badge badge--ai">총 {p.total}개</span>
                </div>
                <div className="row__sub" style={{ marginBottom: 6 }}>
                  픽업 {p.pickupDate} · 공급가 {won(p.supplyPrice)}원 · {p.stores.length}점포
                </div>
                <div className="divider" style={{ margin: "2px 0 8px" }} />
                {p.stores.map((s, i) => (
                  <div className="aggline" key={i}>
                    <span className="aggline__store">{s.storeName}</span>
                    <span className="aggline__qty">{s.qty}개</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
