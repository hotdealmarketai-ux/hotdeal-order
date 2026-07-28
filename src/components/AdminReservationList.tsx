import Link from "next/link";
import { labelDate } from "@/lib/date";
import { isReservationClosed } from "@/lib/reservation";
import type { ReservationBatchListItem } from "@/lib/reservation-data";

// 관리자 예약일자 목록(카드) — 현재/지난 예약발주 페이지 공용.
export function AdminReservationList({
  batches,
  emptyText,
}: {
  batches: ReservationBatchListItem[];
  emptyText: string;
}) {
  if (batches.length === 0) {
    return <div className="empty">{emptyText}</div>;
  }
  return (
    <div className="stack">
      {batches.map((b) => {
        const closed = isReservationClosed(b.reserveDate);
        return (
          <Link
            key={b.id}
            href={`/admin/reservations/${b.id}`}
            className="card resv-card"
          >
            <div className="resv-card__main">
              <div className="resv-card__title">예약 {labelDate(b.reserveDate)}</div>
              <div className="resv-card__sub">
                {b.pickupDates.length === 0
                  ? "상품 없음"
                  : `픽업 ${b.pickupDates.map((d) => labelDate(d)).join(" · ")}`}
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
  );
}
