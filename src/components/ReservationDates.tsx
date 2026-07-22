import { labelDate } from "@/lib/date";
import { reservationDeadlineLabel } from "@/lib/reservation";

// 예약발주 3날짜를 크고 명확하게 — 픽업만 보여 헷갈리던 것 해소.
// 예약 = reserveDate, 픽업 = pickupDate, 마감 = reserveDate 다음날 낮 12시.
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
        <span className="resvdates__k resvdates__k--reserve">예약</span>
        <span className="resvdates__v">{labelDate(reserveDate)}</span>
      </div>
      <div className="resvdates__row">
        <span className="resvdates__k resvdates__k--pickup">픽업</span>
        <span className="resvdates__v resvdates__v--strong">
          {labelDate(pickupDate)}
        </span>
      </div>
      <div className="resvdates__row">
        <span className="resvdates__k resvdates__k--deadline">마감</span>
        <span className="resvdates__v resvdates__v--deadline">
          {reservationDeadlineLabel(reserveDate)}
        </span>
      </div>
    </div>
  );
}
