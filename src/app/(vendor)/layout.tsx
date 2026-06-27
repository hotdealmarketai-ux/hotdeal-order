import { requireVendor } from "@/lib/session";
import { AdminNav } from "@/components/AdminNav";

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireVendor();
  // 새롭(관리자)만 하단 네비(공구 발주 ↔ 관리). 일반 업자는 네비 없음.
  const isAdmin = user.role === "ADMIN_SAEROP";
  return (
    <div className={`app ${isAdmin ? "app--nav" : ""}`}>
      {children}
      {isAdmin ? <AdminNav /> : null}
    </div>
  );
}
