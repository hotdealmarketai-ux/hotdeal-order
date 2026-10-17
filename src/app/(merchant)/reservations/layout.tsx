import { requireMerchant } from "@/lib/session";
import { requireReservationsVisible } from "@/lib/merchant-gate";

// 공산품(옛 예약발주) 전 구간(목록·상세·옛 기록·마감)을 숨기는 관문 — 판정은 merchant-gate 하나만 본다.
// · 지점별 '공산품 노출'(user.reservationEnabled)이 off 이면 /order 로.
// 하단 네비 탭은 BottomNav 에서 이미 숨겨지지만, URL 직접 접근이나 잔존 링크도 여기서 돌려보낸다.
// Next 16 레이아웃은 화면 이동 때 다시 그리지 않으므로 각 page.tsx 에서도 같은 검사를 한다.
export default async function ReservationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireMerchant();
  await requireReservationsVisible(user);
  return <>{children}</>;
}
