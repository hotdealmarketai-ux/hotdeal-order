import { redirect } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import {
  getReservationBatch,
  getBatchConfirmations,
  getInventoryPickList,
} from "@/lib/reservation-data";
import {
  ReservationBatchEditor,
  ReservationBatchDeleteButton,
} from "@/components/ReservationBatchEditor";
import { ConfirmedMerchants } from "@/components/ConfirmedMerchants";
import { labelDate } from "@/lib/date";

export default async function EditReservationBatchPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const batch = await getReservationBatch(id);
  // 삭제/숨김된 배치면 404 대신 목록으로
  if (!batch) redirect("/admin/reservations");
  const [confirmations, inventoryItems] = await Promise.all([
    getBatchConfirmations(batch.id),
    getInventoryPickList(),
  ]);

  return (
    <>
      <Topbar backHref="/admin/reservations" title={`예약 ${labelDate(batch.reserveDate)}`} />
      <div className="page">
        <ReservationBatchEditor batch={batch} inventoryItems={inventoryItems} />

        {/* 확정한 점주 — 점주를 누르면 상품별 예약 수량이 펼쳐진다 */}
        <div className="itemshead" style={{ marginTop: 26 }}>
          <span className="itemshead__label">확정한 점주</span>
          <span className="itemshead__count">{confirmations.length}곳</span>
        </div>
        <ConfirmedMerchants confirmations={confirmations} />

        <ReservationBatchDeleteButton batchId={batch.id} />
      </div>
    </>
  );
}
