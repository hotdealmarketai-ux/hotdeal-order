import { labelDate } from "@/lib/date";
import { reservationDeadlineLabel } from "@/lib/reservation";

// 예약발주 날짜 — 픽업·마감을 같은 크기로 나란히, 예약은 아래 작게.
// 라벨은 조용히(muted), 강조는 값의 색으로(픽업=녹색, 마감=빨강). 깔끔·직관.
export function ReservationDates({
  reserveDate,
  pickupDate,
}: {
  reserveDate: string;
  pickupDate: string;
}) {
  return (
    <div className="resvdates">
      <div className="resvdates__row">
        <span className="resvdates__k">픽업</span>
        <span className="resvdates__v resvdates__v--pickup">
          {labelDate(pickupDate)}
        </span>
      </div>
      <div className="resvdates__row">
        <span className="resvdates__k">마감</span>
        <span className="resvdates__v resvdates__v--deadline">
          {reservationDeadlineLabel(reserveDate)}
        </span>
      </div>
      <div className="resvdates__reserve">예약 {labelDate(reserveDate)}</div>
    </div>
  );
}
