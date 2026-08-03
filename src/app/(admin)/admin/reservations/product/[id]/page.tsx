import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { flatProductStores, getOrCreateFlatBatchId } from "@/lib/reservation-flat";
import { FlatProductStoreEditor } from "@/components/FlatProductStoreEditor";
import { formatKDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

// 관리자 예약상품 상세 — 취합 수량 + 점포별 수량 편집.
export default async function FlatProductDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const [{ product, stores }, batchId] = await Promise.all([
    flatProductStores(id),
    getOrCreateFlatBatchId(),
  ]);
  if (!product) notFound();
  const total = stores.reduce((s, r) => s + r.qty, 0);

  return (
    <>
      <Topbar backHref="/admin/reservations" title={product.name} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">
            픽업 {product.pickupDate} · 공급가 {won(product.supplyPrice)}원
            {product.inventoryItemId ? " · 재고연동" : ""}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
            총 {total}개 · {stores.length}점포
          </div>
          <div className="row__sub" style={{ marginTop: 4 }}>
            마감 {formatKDateTime(new Date(product.closeAtMs))}
          </div>
        </div>

        <div className="section-label">점포별 예약 수량</div>
        <FlatProductStoreEditor batchId={batchId} stores={stores} />
      </div>
    </>
  );
}
