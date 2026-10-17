import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { getInventoryPickList } from "@/lib/reservation-data";
import { closeAtLabel } from "@/lib/flat-group";
import { FlatClosedList } from "@/components/FlatClosedList";

export const dynamic = "force-dynamic";

// 마감된 예약 — 발주 마감은 지났지만 출고일은 아직 안 지난 상품(점포별 수량 대신 고치기 가능).
// 출고일까지 지난 상품은 '출고 지난 공산품'으로 옮겨진다.
export default async function ClosedReservationsPage() {
  await requireAdmin();
  const [products, inventoryItems] = await Promise.all([
    listFlatProductsAdmin("closed"),
    getInventoryPickList(),
  ]);
  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    pickupDate: p.pickupDate,
    supplyPrice: p.supplyPrice,
    inventoryItemId: p.inventoryItemId,
    closeAtLabel: closeAtLabel(p.closeAtMs), // 점주·진행 중 목록과 같은 꼴 "10월 19일 (월) 오전 10시"
    closeAtLocal: new Date(p.closeAt.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16),
    stockFixed: p.stockFixed,
    minPerStore: p.minPerStore,
    description: p.description,
    totalQty: p.totalQty,
    storeCount: p.storeCount,
    components: p.components,
  }));

  return (
    <>
      <Topbar backHref="/admin/reservations" title="마감된 예약" />
      <div className="page">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <Link
            href="/admin/reservations/pickup-closed"
            className="linkbtn"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            출고 지난 공산품 ›
          </Link>
        </div>
        <Link
          href="/admin/reservations/summary?scope=closed"
          className="btn btn--primary btn--block"
          style={{ marginBottom: 14 }}
        >
          전체 집계
        </Link>
        <div className="itemshead">
          <span className="itemshead__label">마감된 예약</span>
          <span className="itemshead__count">{rows.length}개</span>
        </div>
        <FlatClosedList rows={rows} inventoryItems={inventoryItems} emptyText="마감된 예약이 없어요." />
      </div>
    </>
  );
}
