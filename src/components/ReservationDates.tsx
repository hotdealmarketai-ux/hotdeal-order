import { labelDate } from "@/lib/date";
import { reservationDeadlineLabel } from "@/lib/reservation";

// 예약발주 날짜 — 픽업·마감을 같은 크기로 나란히, 예약은 아래 작게.
// 픽업은 이제 상품별이라 여러 개일 수 있음 → 이 예약일자에 올라온 픽업일을 모두 표시.
export function ReservationDates({
  reserveDate,
  pickupDates,
}: {
  reserveDate: string;
  pickupDates: string[];
}) {
  return (
    <div className="resvdates">
      <div className="resvdates__row">
        <span className="resvdates__k">픽업</span>
        <span className="resvdates__v resvdates__v--pickup">
          {pickupDates.length === 0
            ? "상품 없음"
            : pickupDates.map((d) => labelDate(d)).join(" · ")}
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
