import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding } from "@/lib/onboarding";
import { listFlatProductsMerchant } from "@/lib/reservation-flat";
import { FlatReservationMerchant } from "@/components/FlatReservationMerchant";

export const dynamic = "force-dynamic";

// 점주 예약발주 — 단일 목록(상품별 마감 임박순) + 검색 + 실시간 카운트다운 + 품목별 발주 확정.
export default async function ReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  if (needsOnboarding(user)) redirect("/onboarding");
  const products = await listFlatProductsMerchant(user.id, "open");

  return (
    <>
      <Topbar brand="핫딜오더 · 예약발주" />
      <div className="page">
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginBottom: 8 }}
        >
          <Link
            href="/reservations/closed"
            className="linkbtn"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            지난 예약 마감 ›
          </Link>
          <Link
            href="/reservations/past"
            className="linkbtn"
            style={{ color: "var(--green-700)", textDecoration: "none" }}
          >
            지난 예약발주 ›
          </Link>
        </div>

        <FlatReservationMerchant products={products} />
      </div>
    </>
  );
}
