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
      </div>
    </>
  );
}
