import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatchesAdmin } from "@/lib/reservation-data";
import { AdminReservationList } from "@/components/AdminReservationList";

// 지난 예약발주 — 예약일자가 지난 배치 모음. 관리자 예약발주 목록 우상단 '지난 예약발주'로 진입.
export default async function PastReservationsPage() {
  await requireAdmin();
  const batches = await getReservationBatchesAdmin("past");

  return (
    <>
      <Topbar backHref="/admin/reservations" title="지난 예약발주" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">지난 예약일자</span>
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
