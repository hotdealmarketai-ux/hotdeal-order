import { redirect } from "next/navigation";
import { requireMerchant } from "@/lib/session";

// 지점별 '예약발주 노출'(user.reservationEnabled)이 off 이면 예약발주 전 구간(목록·상세·지난·마감)을 숨긴다.
// 하단 네비 탭은 BottomNav 에서 이미 숨겨지지만, URL 직접 접근이나 잔존 링크도 여기서 /order 로 돌려보낸다.
// 기본값 true 이므로 기존 지점은 영향 없음. 관리자 회원관리에서 지점마다 켜고 끈다.
export default async function ReservationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireMerchant();
  if (!user.reservationEnabled) redirect("/order");
  return <>{children}</>;
}
