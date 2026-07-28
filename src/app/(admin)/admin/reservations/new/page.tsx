import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { ReservationBatchEditor } from "@/components/ReservationBatchEditor";
import { getInventoryPickList } from "@/lib/reservation-data";

export default async function NewReservationBatchPage() {
  await requireAdmin();
  const inventoryItems = await getInventoryPickList();
  return (
    <>
      <Topbar backHref="/admin/reservations" title="새 예약일자" />
      <div className="page">
        <ReservationBatchEditor inventoryItems={inventoryItems} />
      </div>
    </>
  );
}
