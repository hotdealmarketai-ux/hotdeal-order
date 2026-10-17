import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { requireReservationsVisible } from "@/lib/merchant-gate";
import { listFlatProductsMerchant } from "@/lib/reservation-flat";
import { FlatReservationMerchant } from "@/components/FlatReservationMerchant";

export const dynamic = "force-dynamic";

// 점주 마감된 예약 — 마감 지난 상품(최근 마감순 묶음). 수량은 못 고치고 '내 발주 N개'(확정분)만 보인다.
// 맨 아래 작은 링크 '이전 기록 ›' = 옛 날짜형 예약발주 기록(/reservations/past).
export default async function MerchantClosedReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  // 공산품 노출 관문 — 레이아웃은 화면 이동 때 다시 검사하지 않으므로 페이지마다 확인.
  await requireReservationsVisible(user);
  const products = await listFlatProductsMerchant(user.id, "closed");

  return (
    <>
      <Topbar backHref="/reservations" title="마감된 예약" />
      <div className="page">
        <FlatReservationMerchant products={products} closedList />
        <div style={{ display: "flex", justifyContent: "center", marginTop: 20 }}>
          <Link
            href="/reservations/past"
            className="linkbtn"
            style={{ color: "var(--muted)", fontSize: 14, textDecoration: "none" }}
          >
            이전 기록 ›
          </Link>
        </div>
      </div>
    </>
  );
}
