import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { listFlatProductsMerchant } from "@/lib/reservation-flat";
import { FlatReservationMerchant } from "@/components/FlatReservationMerchant";

export const dynamic = "force-dynamic";

// 점주 지난 예약 마감 — 마감된 신규 예약상품(내 예약 수량 표시, 수정 불가).
export default async function MerchantClosedReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const products = await listFlatProductsMerchant(user.id, "closed");

  return (
    <>
      <Topbar backHref="/reservations" title="지난 예약 마감" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">마감된 예약상품</span>
          <span className="itemshead__count">{products.length}개</span>
        </div>
        <FlatReservationMerchant products={products} sectioned={false} />
      </div>
    </>
  );
}
