import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { getMerchantPastReservationBatches } from "@/lib/reservation-data";
import { ReservationDates } from "@/components/ReservationDates";

// 점주 지난 예약발주 — 내가 예약했고 픽업이 모두 지난 배치 모음. 예약발주 목록 우상단 '지난 예약발주'로 진입.
export default async function MerchantPastReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const batches = await getMerchantPastReservationBatches(user.id);

  return (
    <>
      <Topbar backHref="/reservations" title="지난 예약발주" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">지난 예약</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        {batches.length === 0 ? (
          <div className="empty">지난 예약발주가 없어요.</div>
        ) : (
          <div className="stack">
            {batches.map((b) => (
              <Link
                key={b.id}
                href={`/reservations/${b.id}`}
                className="card resv-card resv-card--mine"
              >
                <div className="resv-card__main">
                  <ReservationDates
                    reserveDate={b.reserveDate}
                    pickupDates={b.pickupDates}
                  />
                  <div className="resv-card__meta">
                    상품 {b.productCount}개 · 내 예약 {b.reservedQty}개
                  </div>
                </div>
                <span className="badge badge--mute">마감</span>
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
