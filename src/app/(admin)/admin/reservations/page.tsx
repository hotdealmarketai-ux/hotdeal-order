import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import {
  getReservationBatchesAdmin,
  countHiddenReservationBatches,
} from "@/lib/reservation-data";
import { PurgeHiddenReservationsButton } from "@/components/PurgeHiddenReservationsButton";
import { AdminReservationList } from "@/components/AdminReservationList";

export default async function AdminReservationsPage() {
  await requireAdmin();
  const [batches, hiddenCount] = await Promise.all([
    getReservationBatchesAdmin("current"),
    countHiddenReservationBatches(),
  ]);

  return (
    <>
      <Topbar
        brand="새롭 · 예약발주"
        right={
          <Link href="/admin/reservations/past" className="tbar__chip">
            지난 예약발주
          </Link>
        }
      />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">예약일자 목록</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        <AdminReservationList
          batches={batches}
          emptyText="진행 중인 예약발주가 없어요. 아래에서 새로 만들어 주세요."
        />

        <Link
          href="/admin/reservations/new"
          className="btn btn--primary btn--block"
          style={{ marginTop: 16 }}
        >
          + 새 예약일자 만들기
        </Link>

        {/* 숨겨진(삭제된) 예약이 같은 날짜 재생성을 막을 때 완전 삭제 */}
        <PurgeHiddenReservationsButton count={hiddenCount} />
      </div>
    </>
  );
}
