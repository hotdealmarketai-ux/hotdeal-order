import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { flatProductStores } from "@/lib/reservation-flat";
import { reservationConfirmedByItem } from "@/lib/reservation-stock";
import { FlatProductStoreEditor } from "@/components/FlatProductStoreEditor";
import { closeAtLabel } from "@/lib/flat-group";
import { labelShipment } from "@/lib/date";
import { qtyRuleBadges } from "@/lib/flat-qty-rule";

export const dynamic = "force-dynamic";

const won = (n: number) => n.toLocaleString("ko-KR");

// 관리자 공산품 상세 — 확정 수량 + 수량 규칙 + 점포별 수량 대신 고치기(전 가맹점) + 재고/부족 요약.
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
  const rule = { minPerStore: product.minPerStore, qtyStep: product.qtyStep };
  const ruleBadges = qtyRuleBadges(rule);
  const belowCount = stores.filter((r) => r.belowRule).length;

  // 재고연동 — 재고품목(inventoryItem) 기준 재고/공산품/부족. 공산품은 '확정분'만(재고현황과 동일 기준).
  // ⚠ 이 수치는 '이 재고품목 전체'(같은 재고를 쓰는 다른 공산품 포함)라 상품별로 더하면 안 됨 → 공유 시 안내.
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
            {labelShipment(product.pickupDate)} · 공급가 {won(product.supplyPrice)}원
            {product.inventoryItemId
              ? product.stockFixed
                ? " · 재고 연동 · 재고 고정"
                : " · 재고 연동"
              : ""}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800, marginTop: 6 }}>
            총 {total}개 · 지점 {orderedCount}곳
          </div>
          <div className="row__sub" style={{ marginTop: 4 }}>
            발주 마감 {closeAtLabel(product.closeAtMs)}
          </div>
          {/* 수량 규칙 — 점주 화면과 같은 말(규칙 없으면 줄 없음). 규칙과 다른 확정 수량이 있으면 빨간 점 수. */}
          {(ruleBadges.length > 0 || belowCount > 0) && (
            <div className="fpse__rule">
              {ruleBadges.join(" · ")}
              {belowCount > 0 && (
                <span className="fpse__badtext">
                  <span className="fpse__bad" aria-hidden="true" />
                  수량 확인 필요 {belowCount}곳
                </span>
              )}
            </div>
          )}
          {product.description && <div className="row__sub">{product.description}</div>}
          {/* 재고연동 — '이 재고품목 전체' 재고 대비 공산품, 초과 시 부족분(납품처 추가 주문분)을 크게. */}
          {stockInfo && (
            <div className={`resvstock${stockInfo.short > 0 ? " resvstock--short" : ""}`}>
              재고 <b>{stockInfo.base}개</b> · 발주 <b>{stockInfo.reserved}개</b>
              {stockInfo.shared > 1 && <span className="resvstock__note"> (다른 공산품 포함)</span>}
              {stockInfo.short > 0 ? (
                <>
                  {" "}· <b className="resvstock__short">부족 {stockInfo.short}개</b>
                </>
              ) : (
                <>
                  {" "}· 남은 수량 <b>{stockInfo.base - stockInfo.reserved}개</b>
                </>
              )}
            </div>
          )}
        </div>

        <div className="section-label">지점별 발주 수량</div>
        <FlatProductStoreEditor
          productId={product.id}
          stores={stores}
          editable={!product.pickupPassed}
          closed={product.closed}
          rule={rule}
        />

        {/* 맨 밑 — '들어온 지점만' 정리된 집계(읽기전용). */}
        <div className="section-label" style={{ marginTop: 22 }}>
          지점별 합계
        </div>
        <div className="card">
          {orderedStores.length === 0 ? (
            <div className="row__sub">발주한 지점이 없어요.</div>
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
                  <b>합계</b>
                </span>
                <span className="aggline__qty">
                  <b>
                    {total}개 · 지점 {orderedStores.length}곳
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
