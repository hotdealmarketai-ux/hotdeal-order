import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatchesAdmin } from "@/lib/reservation-data";
import { AdminReservationList } from "@/components/AdminReservationList";

// 옛 예약발주 기록 — 기존(날짜형) 예약 전부. 새 단일목록으로 전환하며 레거시 예약을 여기로 모은다.
// (출고 안 된 상품이 있어 한동안 유지) 관리자 공산품 우상단 '옛 예약발주 기록'으로 진입.
export const dynamic = "force-dynamic";

export default async function PastReservationsPage() {
  await requireAdmin();
  const batches = await getReservationBatchesAdmin("legacy");

  return (
    <>
      <Topbar backHref="/admin/reservations" title="이전 기록" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">발주 날짜</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        <AdminReservationList
          batches={batches}
          emptyText="이전 기록이 없어요."
        />
      </div>
    </>
  );
}
