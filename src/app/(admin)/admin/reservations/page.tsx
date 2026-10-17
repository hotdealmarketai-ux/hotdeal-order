import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { getInventoryPickList } from "@/lib/reservation-data";
import { FlatReservationAdmin } from "@/components/FlatReservationAdmin";

export const dynamic = "force-dynamic";

// 관리자 공산품(옛 예약발주) — 상품별 발주 마감·출고일 등록(연속 등록·복사), 마감 시각 → 출고일 묶음 목록.
export default async function AdminReservationsPage() {
  await requireAdmin();
  const [products, inventoryItems] = await Promise.all([
    listFlatProductsAdmin("open"),
    getInventoryPickList(),
  ]);

  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    pickupDate: p.pickupDate,
    supplyPrice: p.supplyPrice,
    inventoryItemId: p.inventoryItemId,
    closeAtMs: p.closeAtMs,
    closeAtLocal: new Date(p.closeAtMs + 9 * 3600 * 1000).toISOString().slice(0, 16),
    stockFixed: p.stockFixed,
    minPerStore: p.minPerStore,
    qtyStep: p.qtyStep,
    description: p.description,
    totalQty: p.totalQty,
    storeCount: p.storeCount,
    components: p.components,
  }));

  return (
    <>
      <Topbar brand="새롭 · 공산품" />
      <div className="page">
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginBottom: 6 }}
        >
          <Link
            href="/admin/reservations/closed"
            className="linkbtn"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            마감된 공산품 ›
          </Link>
          <Link
            href="/admin/reservations/past"
            className="linkbtn"
            style={{ color: "var(--green-700)", textDecoration: "none" }}
          >
            이전 기록 ›
          </Link>
        </div>

        <Link
          href="/admin/reservations/summary?scope=open"
          className="btn btn--primary btn--block"
          style={{ marginBottom: 14 }}
        >
          전체 집계
        </Link>

        <FlatReservationAdmin products={rows} inventoryItems={inventoryItems} />
      </div>
    </>
  );
}
