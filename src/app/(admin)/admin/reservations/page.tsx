import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { getInventoryPickList } from "@/lib/reservation-data";
import { FlatReservationAdmin } from "@/components/FlatReservationAdmin";

export const dynamic = "force-dynamic";

// 관리자 예약발주 — 날짜 뎁스 없는 단일 목록. 상품별 마감(시분초) 등록, 마감 임박순 노출.
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
    closeAtMs: p.closeAt.getTime(),
    closeAtLocal: new Date(p.closeAt.getTime() + 9 * 3600 * 1000)
      .toISOString()
      .slice(0, 16),
    stockFixed: p.stockFixed,
    totalQty: p.totalQty,
    storeCount: p.storeCount,
  }));

  return (
    <>
      <Topbar brand="새롭 · 예약발주" />
      <div className="page">
        <div
          style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginBottom: 6 }}
        >
          <Link
            href="/admin/reservations/closed"
            className="linkbtn"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            지난 예약 마감 ›
          </Link>
          <Link
            href="/admin/reservations/past"
            className="linkbtn"
            style={{ color: "var(--green-700)", textDecoration: "none" }}
          >
            지난 예약발주 ›
          </Link>
        </div>

        <Link
          href="/admin/reservations/summary?scope=open"
          className="btn btn--primary btn--block"
          style={{ marginBottom: 14 }}
        >
          전체 집계 보기
        </Link>

        <FlatReservationAdmin products={rows} inventoryItems={inventoryItems} />
      </div>
    </>
  );
}
