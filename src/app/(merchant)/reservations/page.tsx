import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { requireReservationsVisible } from "@/lib/merchant-gate";
import { needsOnboarding } from "@/lib/onboarding";
import { listFlatProductsMerchant, listMyFlatOrders } from "@/lib/reservation-flat";
import { FlatReservationMerchant } from "@/components/FlatReservationMerchant";

export const dynamic = "force-dynamic";

// 점주 공산품(옛 예약발주, 주소 /reservations 그대로) — 마감 시각 묶음 → 출고일 → 1열 카드.
// 숫자 고르고 [발주하기] 한 번(바꾸면 [변경 저장], 0이면 [발주 취소]). 맨 위 '내 발주 N건 · 금액'.
// 옛 날짜형 예약발주 기록은 마감된 공산품 화면 맨 아래 '이전 기록 ›' 으로 들어간다.
export default async function ReservationsPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  if (needsOnboarding(user)) redirect("/onboarding");
  // 공산품 노출 관문 — 레이아웃은 화면 이동 때 다시 검사하지 않으므로 페이지마다 확인.
  await requireReservationsVisible(user);
  const [products, myOrders] = await Promise.all([
    listFlatProductsMerchant(user.id, "open"),
    listMyFlatOrders(user.id),
  ]);

  return (
    <>
      <Topbar brand="핫딜오더 · 공산품" />
      <div className="page">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
          <Link
            href="/reservations/closed"
            className="linkbtn"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            마감된 공산품 ›
          </Link>
        </div>

        <FlatReservationMerchant products={products} myOrders={myOrders} />
      </div>
    </>
  );
}
