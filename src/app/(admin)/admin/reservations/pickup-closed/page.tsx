import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { formatKDateTime } from "@/lib/format";
import { FlatClosedList } from "@/components/FlatClosedList";

export const dynamic = "force-dynamic";

// 지난 픽업 마감 — 예약 마감 + 픽업일까지 지난 상품이 계속 쌓이는 아카이브. 상단 검색으로 찾는다.
// 여기 상품은 점포별 수량 편집은 조회만 가능(상세 페이지가 읽기전용).
export default async function PickupClosedReservationsPage() {
  await requireAdmin();
  const products = await listFlatProductsAdmin("pickupClosed");
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
      <Topbar backHref="/admin/reservations/closed" title="지난 픽업 마감" />
      <div className="page">
        <div className="itemshead">
          <span className="itemshead__label">픽업까지 지난 예약상품</span>
          <span className="itemshead__count">{rows.length}개</span>
        </div>
        <FlatClosedList rows={rows} emptyText="지난 픽업 마감 상품이 없어요." />
      </div>
    </>
  );
}
