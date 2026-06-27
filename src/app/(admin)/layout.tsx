import { requireAdmin } from "@/lib/session";
import { AdminNav } from "@/components/AdminNav";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();
  return (
    <div className="app app--nav">
      {children}
      <AdminNav />
    </div>
  );
}
