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
        <HoldsBoard initial={initial} />
      </div>
    </>
  );
}
