import { notFound, redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { getMerchantReservation } from "@/lib/reservation-data";
import { ReservationOrderForm } from "@/components/ReservationOrderForm";
import { ReservationDeadlineCountdown } from "@/components/ReservationDeadlineCountdown";
import { ReservationDates } from "@/components/ReservationDates";
import { isReservationClosed } from "@/lib/reservation";
import { labelDate } from "@/lib/date";

export default async function ReservationDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const { id } = await props.params;
  const detail = await getMerchantReservation(id, user.id);
  if (!detail) notFound();

  const closed = isReservationClosed(detail.reserveDate);

  return (
    <>
      <Topbar backHref="/reservations" title={`픽업 ${labelDate(detail.pickupDate)}`}>
        <ReservationDeadlineCountdown
          reserveDate={detail.reserveDate}
          pickupDate={detail.pickupDate}
        />
      </Topbar>
      <div className="page">
        <div className="card resvdates-card">
          <ReservationDates
            reserveDate={detail.reserveDate}
            pickupDate={detail.pickupDate}
          />
        </div>
        <ReservationOrderForm
          batchId={detail.id}
          products={detail.products}
          confirmed={detail.confirmed}
          qtyByProduct={detail.qtyByProduct}
          closed={closed}
        />
      </div>
    </>
  );
}
