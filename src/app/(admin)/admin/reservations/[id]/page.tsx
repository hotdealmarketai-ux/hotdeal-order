import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatch } from "@/lib/reservation-data";
import {
  ReservationBatchEditor,
  ReservationBatchDeleteButton,
} from "@/components/ReservationBatchEditor";
import { labelDate } from "@/lib/date";

export default async function EditReservationBatchPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const batch = await getReservationBatch(id);
  if (!batch) notFound();

  return (
    <>
      <Topbar backHref="/admin/reservations" title={`예약 ${labelDate(batch.reserveDate)}`} />
      <div className="page">
        <ReservationBatchEditor batch={batch} />
        <ReservationBatchDeleteButton batchId={batch.id} />
      </div>
    </>
  );
}
