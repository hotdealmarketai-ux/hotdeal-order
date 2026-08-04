import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { flatProductStores } from "@/lib/reservation-flat";
import { FlatProductStoreEditor } from "@/components/FlatProductStoreEditor";
import { formatKDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

// 관리자 예약상품 상세 — 취합 수량 + 점포별 수량 편집(전 가맹점).
export default async function FlatProductDetailPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const { product, stores } = await flatProductStores(id);
  if (!product) notFound();
  const total = stores.reduce((s, r) => s + r.qty, 0);
  const orderedStores = stores.filter((r) => r.qty > 0);
  const orderedCount = orderedStores.length;

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
            총 {total}개 · {orderedCount}점포
          </div>
          <div className="row__sub" style={{ marginTop: 4 }}>
            마감 {formatKDateTime(new Date(product.closeAtMs))}
          </div>
        </div>

        <div className="section-label">점포별 예약 수량</div>
        <FlatProductStoreEditor
          productId={product.id}
          stores={stores}
          editable={!product.pickupPassed}
        />

        {/* 맨 밑 — '들어온 지점만' 정리된 집계(읽기전용). */}
        <div className="section-label" style={{ marginTop: 22 }}>
          집계 (발주한 지점)
        </div>
        <div className="card">
          {orderedStores.length === 0 ? (
            <div className="row__sub">아직 발주한 지점이 없어요.</div>
          ) : (
            <>
              {orderedStores.map((r) => (
                <div className="aggline" key={r.userId}>
                  <span className="aggline__store">{r.storeName}</span>
                  <span className="aggline__qty">{r.qty}개</span>
                </div>
              ))}
              <div className="divider" style={{ margin: "8px 0" }} />
              <div className="aggline">
                <span className="aggline__store">
                  <b>총 합계</b>
                </span>
                <span className="aggline__qty">
                  <b>
                    {total}개 · {orderedStores.length}점포
                  </b>
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
