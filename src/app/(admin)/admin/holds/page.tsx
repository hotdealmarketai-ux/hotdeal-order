import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getHoldsOverview } from "@/lib/holds";
import { HoldsBoard } from "@/components/admin/HoldsBoard";

export const dynamic = "force-dynamic";

// 담기 현황 — 지금 각 점포가 담아둔 재고현황 담기 + 예약 재고연동 수량을 실시간으로 보고,
// 한 점포가 저재고 품목을 독점하면 관리자가 −/+ 로 바로 재배분한다.
export default async function AdminHoldsPage() {
  await requireAdmin();
  const initial = await getHoldsOverview();

  return (
    <>
      <Topbar backHref="/admin" title="담기 현황" />
      <div className="page">
        <p className="hint" style={{ margin: "0 0 12px", lineHeight: 1.5 }}>
          지금 각 점포가 담아둔 <b>재고현황 담기</b>·<b>예약발주 재고연동</b> 수량이에요.
          품목별로 남은수량이 적은 순으로 보여요. <b>− / +</b> 로 특정 점포 수량을 바로
          조정하면 다른 점포가 담을 수 있어요.
        </p>
        <HoldsBoard initial={initial} />
      </div>
    </>
  );
}
