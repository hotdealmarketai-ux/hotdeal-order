import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { formatKDateTime } from "@/lib/format";
import { FlatClosedList } from "@/components/FlatClosedList";

export const dynamic = "force-dynamic";

// 지난 예약 마감 — 예약 마감은 지났지만 픽업일은 아직 안 지난 상품(점포별 수량 수정 가능).
// 픽업일까지 지난 상품은 '지난 픽업 마감'으로 이동한다.
export default async function ClosedReservationsPage() {
  await requireAdmin();
  const products = await listFlatProductsAdmin("closed");
  const rows = products.map((p) => ({
    id: p.id,
    name: p.name,
    pickupDate: p.pickupDate,
    supplyPrice: p.supplyPrice,
    inventoryItemId: p.inventoryItemId,
    closeAtLabel: formatKDateTime(p.closeAt),
    totalQty: p.totalQty,
    storeCount: p.storeCount,
  }));

  return (
    <>
      <Topbar backHref="/admin/reservations" title="지난 예약 마감" />
      <div className="page">
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
          <Link
            href="/admin/reservations/pickup-closed"
            className="linkbtn"
            style={{ color: "var(--muted)", textDecoration: "none" }}
          >
            지난 픽업 마감 ›
          </Link>
        </div>
        <div className="itemshead">
          <span className="itemshead__label">마감된 예약상품</span>
          <span className="itemshead__count">{rows.length}개</span>
        </div>
        <FlatClosedList rows={rows} emptyText="마감된 예약상품이 없어요." />
      </div>
    </>
  );
}
