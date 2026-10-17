import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { requireReservationsVisible } from "@/lib/merchant-gate";
import { getMerchantPastReservationBatches } from "@/lib/reservation-data";
import { ReservationDates } from "@/components/ReservationDates";

// 점주 이전 기록 — 옛 날짜형 예약발주에서 내가 발주했고 출고가 모두 지난 배치 모음. 마감된 공산품 맨 아래 '이전 기록 ›' 으로 진입.
export default async function MerchantPastReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  // 공산품 노출 관문 — 레이아웃은 화면 이동 때 다시 검사하지 않으므로 페이지마다 확인.
  await requireReservationsVisible(user);
  const batches = await getMerchantPastReservationBatches(user.id);

  return (
    <>
      <Topbar backHref="/reservations" title="이전 기록" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">지난 발주</span>
          <span className="itemshead__count">{batches.length}개</span>
        </div>

        {batches.length === 0 ? (
          <div className="empty">이전 기록이 없어요.</div>
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
                    상품 {b.productCount}개 · 내 발주 {b.reservedQty}개
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
