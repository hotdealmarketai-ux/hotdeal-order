import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { getMerchantReservationBatches } from "@/lib/reservation-data";
import { reservationStatusOf } from "@/lib/reservation";
import { ReservationDates } from "@/components/ReservationDates";

export default async function ReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const batches = await getMerchantReservationBatches(user.id);

  return (
    <>
      <Topbar brand="핫딜오더 · 예약발주" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">예약 가능한 날짜</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        {batches.length === 0 ? (
          <div className="empty">지금은 예약할 수 있는 상품이 없습니다.</div>
        ) : (
          <div className="stack">
            {batches.map((b) => {
              const st = reservationStatusOf({ confirmed: b.confirmed }, b.reserveDate);
              return (
                <Link
                  key={b.id}
                  href={`/reservations/${b.id}`}
                  className={`card resv-card${b.reservedQty > 0 ? " resv-card--mine" : ""}`}
                >
                  <div className="resv-card__main">
                    <ReservationDates
                      reserveDate={b.reserveDate}
                      pickupDate={b.pickupDate}
                    />
                    <div className="resv-card__meta">
                      상품 {b.productCount}개
                      {b.reservedQty > 0 ? ` · 내 예약 ${b.reservedQty}개` : ""}
                    </div>
                  </div>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
