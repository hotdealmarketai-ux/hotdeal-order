import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { computeOrderShipmentDiff } from "@/lib/order-shipment-diff";
import { OrderShipmentDiffView } from "@/components/OrderShipmentDiffView";
import { normalizeDateStr } from "@/lib/date";

export const dynamic = "force-dynamic";

// 발주↔출고 대조 — 그 출고일 본사출고 발주(공구·채움채·주간)와 발행된 계산서를 품목명 기준으로
// 대조해 수량이 어긋난(재고 튐) 품목만 총합/지점별로 보여준다. 재고 차감 없음(눈으로 확인용).
export default async function OrderShipmentDiffPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const data = await computeOrderShipmentDiff(date);

  return (
    <>
      <Topbar backHref={`/admin/stock-reconcile?date=${date}`} title="발주↔출고 대조" />
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

        <OrderShipmentDiffView data={data} />
      </div>
    </>
  );
}
