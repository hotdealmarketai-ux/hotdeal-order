import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import {
  getMerchantReservation,
  getReservationChangesForMerchant,
} from "@/lib/reservation-data";
import { availableForReservationProducts } from "@/lib/reservation-stock";
import { ReservationOrderForm } from "@/components/ReservationOrderForm";
import { ReservationChangeHistory } from "@/components/ReservationChangeHistory";
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
  // 배치가 삭제/숨김되면 404 대신 예약발주 목록으로 (점주가 막다른 페이지에 갇히지 않게)
  if (!detail) redirect("/reservations");

  const closed = isReservationClosed(detail.reserveDate);
  // 연동 상품의 실시간 남은수량 SSR 초기값(이후 클라 폴링이 갱신)
  const availableByProduct = await availableForReservationProducts(detail.products);

  // 본사(관리자)가 내 예약을 수정한 내역 — 점주 열람용.
  const changeEntries = (
    await getReservationChangesForMerchant(detail.id, user.id)
  ).map((r) => {
    let changes: {
      name: string;
      op: "changed" | "removed";
      before: number;
      after: number;
    }[] = [];
    try {
      const a = JSON.parse(r.changes);
      if (Array.isArray(a)) changes = a;
    } catch {}
    return { id: r.id, actorName: r.actorName, createdAt: r.createdAt, changes };
  });

  return (
    <>
      <Topbar backHref="/reservations" title={`예약 ${labelDate(detail.reserveDate)}`}>
        <ReservationDeadlineCountdown
          reserveDate={detail.reserveDate}
          pickupDates={detail.pickupDates}
        />
      </Topbar>
      <div className="page">
        <div className="card resvdates-card">
          <ReservationDates
            reserveDate={detail.reserveDate}
            pickupDates={detail.pickupDates}
          />
        </div>
        <ReservationOrderForm
          batchId={detail.id}
          products={detail.products}
          confirmed={detail.confirmed}
          qtyByProduct={detail.qtyByProduct}
          closed={closed}
          availableByProduct={availableByProduct}
        />
        <ReservationChangeHistory entries={changeEntries} />
      </div>
    </>
  );
}
