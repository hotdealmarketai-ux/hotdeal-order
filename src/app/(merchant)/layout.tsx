import { requireMerchant } from "@/lib/session";
import { receivableOf } from "@/lib/receivable";
import { weeklyReceivableOf } from "@/lib/weekly";
import { canOrderWeekly } from "@/lib/constants";
import { BottomNav } from "@/components/BottomNav";

export default async function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireMerchant();
  // 마이 탭 배지 = 미입금(입금요청 도착) 계산서 건수, 주간발주 탭 배지 = 미입금 주간 요청서 건수
  const [{ count }, weekly] = await Promise.all([
    receivableOf(user.id),
    canOrderWeekly(user.role)
      ? weeklyReceivableOf(user.id)
      : Promise.resolve({ count: 0, balance: 0 }),
  ]);
  return (
    <div className="app app--nav">
      {children}
      <BottomNav role={user.role} myBadge={count} weeklyBadge={weekly.count} />
    </div>
  );
}
