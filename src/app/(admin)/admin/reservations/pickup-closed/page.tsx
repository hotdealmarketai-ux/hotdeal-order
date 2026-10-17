import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { listFlatProductsAdmin } from "@/lib/reservation-flat";
import { getInventoryPickList } from "@/lib/reservation-data";
import { closeAtLabel } from "@/lib/flat-group";
import { FlatClosedList } from "@/components/FlatClosedList";

export const dynamic = "force-dynamic";

// 출고 지난 공산품 — 발주 마감 + 출고일까지 지난 상품이 계속 쌓이는 기록. 상단 검색으로 찾는다.
// 여기 상품은 점포별 수량을 보기만 한다(상세 페이지가 읽기전용).
export default async function PickupClosedReservationsPage() {
  await requireAdmin();
  const [products, inventoryItems] = await Promise.all([
    listFlatProductsAdmin("pickupClosed"),
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
      <Topbar backHref="/admin/reservations/closed" title="출고 지난 공산품" />
      <div className="page">
        <Link
          href="/admin/reservations/summary?scope=pickupClosed"
          className="btn btn--primary btn--block"
          style={{ marginBottom: 14 }}
        >
          전체 집계
        </Link>
        <div className="itemshead">
          <span className="itemshead__label">출고 지난 공산품</span>
          <span className="itemshead__count">{rows.length}개</span>
        </div>
        <FlatClosedList rows={rows} inventoryItems={inventoryItems} emptyText="출고 지난 공산품이 없어요." />
      </div>
    </>
  );
}
