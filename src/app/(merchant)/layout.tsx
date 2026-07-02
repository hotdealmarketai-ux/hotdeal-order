import { requireMerchant } from "@/lib/session";
import { receivableOf } from "@/lib/receivable";
import { BottomNav } from "@/components/BottomNav";

export default async function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireMerchant();
  // 마이 탭 배지 = 미입금(입금요청 도착) 계산서 건수
  const { count } = await receivableOf(user.id);
  return (
    <div className="app app--nav">
      {children}
      <BottomNav role={user.role} myBadge={count} />
    </div>
  );
}
