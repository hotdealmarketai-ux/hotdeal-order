import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { ReservationBatchEditor } from "@/components/ReservationBatchEditor";

export default async function NewReservationBatchPage() {
  await requireAdmin();
  return (
    <>
      <Topbar backHref="/admin/reservations" title="새 예약일자" />
      <div className="page">
        <ReservationBatchEditor />
      </div>
    </>
  );
}
