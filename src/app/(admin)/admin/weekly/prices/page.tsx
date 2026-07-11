import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getWeeklyProducts } from "@/lib/weekly";
import { WeeklyProductForm } from "@/components/WeeklyProductForm";

export default async function AdminWeeklyProductsPage() {
  await requireAdmin();
  const products = await getWeeklyProducts();

  return (
    <>
      <Topbar backHref="/admin/weekly" title="상품 관리" />
      <div className="page">
        <WeeklyProductForm initial={products} />
        <div style={{ marginTop: 20 }}>
          <Link href="/admin/weekly" className="btn btn--ghost btn--block">
            주간발주로 돌아가기
          </Link>
        </div>
      </div>
    </>
  );
}
