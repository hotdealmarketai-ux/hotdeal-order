import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatchesAdmin } from "@/lib/reservation-data";
import { labelDate } from "@/lib/date";
import { isReservationClosed, reservationLoadDate } from "@/lib/reservation";

export default async function AdminReservationsPage() {
  await requireAdmin();
  const batches = await getReservationBatchesAdmin();

  return (
    <>
      <Topbar brand="새롭 · 예약발주" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">예약일자 목록</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        {batches.length === 0 ? (
          <div className="empty">아직 등록된 예약발주가 없어요. 아래에서 새로 만들어 주세요.</div>
        ) : (
          <div className="stack">
            {batches.map((b) => {
              const closed = isReservationClosed(b.reserveDate);
              return (
                <Link key={b.id} href={`/admin/reservations/${b.id}`} className="card resv-card">
                  <div className="resv-card__main">
                    <div className="resv-card__title">예약 {labelDate(b.reserveDate)}</div>
                    <div className="resv-card__sub">
                      픽업 {labelDate(b.pickupDate)} · 공구반영 {labelDate(reservationLoadDate(b.pickupDate))}
                    </div>
                    <div className="resv-card__meta">
                      상품 {b.productCount}개 · 예약 {b.orderCount}건
                    </div>
                  </div>
                  <span className={`badge ${closed ? "badge--mute" : "badge--wait"}`}>
                    {closed ? "마감" : "예약 중"}
                  </span>
                </Link>
              );
            })}
          </div>
        )}

        <Link
          href="/admin/reservations/new"
          className="btn btn--primary btn--block"
          style={{ marginTop: 16 }}
        >
          + 새 예약일자 만들기
        </Link>
      </div>
    </>
  );
}
