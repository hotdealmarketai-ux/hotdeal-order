import { requireMerchant } from "@/lib/session";
import { receivableOf } from "@/lib/receivable";
import { weeklyReceivableOf } from "@/lib/weekly";
import { canOrderWeekly } from "@/lib/constants";
import { maintenanceOn } from "@/lib/maintenance";
import { needsOnboarding } from "@/lib/onboarding";
import { BottomNav } from "@/components/BottomNav";
import { MaintenanceGate } from "@/components/MaintenanceGate";

export default async function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireMerchant();
  // 패치(유지보수) 모드 ON이면 가맹점은 화면 전체를 안내로 잠근다(네비·내용 모두 숨김).
  if (await maintenanceOn()) {
    return (
      <div className="app">
        <MaintenanceGate />
      </div>
    );
  }
  // 튜토리얼(오픈 준비) 중이면 발주 네비 숨김. 기존 점주는 needsOnboarding=false 라 영향 없음.
  // 잠금의 실제 강제는 각 발주 페이지 리다이렉트(order/day·weekly·reservations) + 발주 생성 액션 가드에서 한다.
  // (여기서 리다이렉트하면 /onboarding 자체도 이 레이아웃을 거쳐 무한 루프가 되므로 네비만 숨긴다.)
  if (needsOnboarding(user)) {
    return <div className="app">{children}</div>;
  }
  // 탭 배지는 '지점 총미수(receivableOf)가 남아 있을 때만' 표시한다(2026-08-05~). 매칭·수동조정으로 다 갚으면
  // 배지가 사라진다. 계산서 status는 결제돼도 ISSUED로 남아(입금확인 폐지) count만으로는 완납 후에도 안 사라지므로,
  // 지점 미수 잔액으로 게이트한다(낱장 정산 추정은 이중납부 위험이라 하지 않음).
  const [{ count, balance }, weekly] = await Promise.all([
    receivableOf(user.id),
    canOrderWeekly(user.role)
      ? weeklyReceivableOf(user.id)
      : Promise.resolve({ count: 0, balance: 0 }),
  ]);
  // 배지는 '점(dot)'으로만 표시(BottomNav) — 계산서가 결제돼도 ISSUED로 남아 건수는 무의미하므로 숫자를 안 쓴다.
  // 값>0 이면 점이 켜진다: 마이=지점 미수 있음, 주간=지점 미수 있고 주간 계산서도 있을 때.
  const owes = balance > 0;
  void count;
  return (
    <div className="app app--nav">
      {children}
      <BottomNav
        role={user.role}
        myBadge={owes ? 1 : 0}
        weeklyBadge={owes && weekly.count > 0 ? 1 : 0}
        reservationEnabled={user.reservationEnabled}
      />
    </div>
  );
}
