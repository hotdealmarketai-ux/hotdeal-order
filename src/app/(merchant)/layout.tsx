import { requireMerchant } from "@/lib/session";
import { BottomNav } from "@/components/BottomNav";

export default async function MerchantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireMerchant();
  return (
    <div className="app app--nav">
      {children}
      <BottomNav role={user.role} />
    </div>
  );
}
