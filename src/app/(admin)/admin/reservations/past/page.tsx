import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatchesAdmin } from "@/lib/reservation-data";
import { AdminReservationList } from "@/components/AdminReservationList";

// 지난 예약발주 — 기존(날짜형) 예약 전부. 새 단일목록으로 전환하며 레거시 예약을 여기로 모은다.
// (출고 안 된 상품이 있어 한동안 유지) 관리자 예약발주 우상단 '지난 예약발주'로 진입.
export const dynamic = "force-dynamic";

export default async function PastReservationsPage() {
  await requireAdmin();
  const batches = await getReservationBatchesAdmin("legacy");

  return (
    <>
      <Topbar backHref="/admin/reservations" title="지난 예약발주" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">기존 예약일자</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        <AdminReservationList
          batches={batches}
          emptyText="지난 예약발주가 없어요."
        />
      </div>
    </>
  );
}
