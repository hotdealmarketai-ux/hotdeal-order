import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { flatProductStores } from "@/lib/reservation-flat";
import { reservationConfirmedByItem } from "@/lib/reservation-stock";
import { FlatProductStoreEditor } from "@/components/FlatProductStoreEditor";
import { formatKDateTime } from "@/lib/format";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

// 관리자 예약상품 상세 — 취합 수량 + 점포별 수량 편집(전 가맹점) + 재고/부족 요약.
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

  // 재고연동 — 재고품목(inventoryItem) 기준 재고/예약/부족. 예약은 '확정분'만(재고현황과 동일 기준).
  // ⚠ 이 수치는 '이 재고품목 전체'(같은 재고를 쓰는 다른 예약상품 포함)라 상품별로 더하면 안 됨 → 공유 시 안내.
  let stockInfo: { base: number; reserved: number; short: number; shared: number } | null = null;
  if (product.inventoryItemId) {
    const [inv, resvConfirmed, shared] = await Promise.all([
      prisma.inventoryItem.findUnique({
        where: { id: product.inventoryItemId },
        select: { qty: true },
      }),
      reservationConfirmedByItem(),
      prisma.reservationProduct.count({
        where: { inventoryItemId: product.inventoryItemId, active: true, closeAt: { not: null } },
      }),
    ]);
    const base = inv?.qty ?? 0;
    const reserved = resvConfirmed[product.inventoryItemId] ?? 0;
    stockInfo = { base, reserved, short: Math.max(0, reserved - base), shared };
  }

  return (
    <>
      <Topbar backHref="/admin/reservations" title={product.name} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">
            픽업 {product.pickupDate} · 공급가 {won(product.supplyPrice)}원
            {product.inventoryItemId
              ? product.stockFixed
                ? " · 재고연동(재고 고정)"
                : " · 재고연동"
              : ""}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
            총 {total}개 · {orderedCount}점포
          </div>
          <div className="row__sub" style={{ marginTop: 4 }}>
            마감 {formatKDateTime(new Date(product.closeAtMs))}
          </div>
          {/* 재고연동 — '이 재고품목 전체' 재고 대비 예약, 초과 시 부족분(납품처 추가 주문분)을 크게. */}
          {stockInfo && (
            <div className={`resvstock${stockInfo.short > 0 ? " resvstock--short" : ""}`}>
              이 재고품목 — 재고 <b>{stockInfo.base}개</b> · 예약 <b>{stockInfo.reserved}개</b>
              {stockInfo.short > 0 ? (
                <>
                  {" "}· <b className="resvstock__short">부족 {stockInfo.short}개</b>
                </>
              ) : (
                <>
                  {" "}· 판매가능 <b>{stockInfo.base - stockInfo.reserved}개</b>
                </>
              )}
              {stockInfo.shared > 1 && (
                <span className="resvstock__note"> · 여러 예약상품이 이 재고 공유(재고현황에서 합산 확인)</span>
              )}
            </div>
          )}
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
