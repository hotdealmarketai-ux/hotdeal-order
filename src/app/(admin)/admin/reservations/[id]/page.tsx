import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatch, getBatchConfirmations } from "@/lib/reservation-data";
import {
  ReservationBatchEditor,
  ReservationBatchDeleteButton,
} from "@/components/ReservationBatchEditor";
import { labelDate } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");

export default async function EditReservationBatchPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const batch = await getReservationBatch(id);
  if (!batch) notFound();
  const confirmations = await getBatchConfirmations(batch.id);

  return (
    <>
      <Topbar backHref="/admin/reservations" title={`예약 ${labelDate(batch.reserveDate)}`} />
      <div className="page">
        <ReservationBatchEditor batch={batch} />

        {/* 확정한 점주 — 예약분은 픽업일 전날 발주·계산서 공구에 자동 반영(별도 발행 없음) */}
        <div className="itemshead" style={{ marginTop: 26 }}>
          <span className="itemshead__label">확정한 점주</span>
          <span className="itemshead__count">{confirmations.length}곳</span>
        </div>
        {confirmations.length === 0 ? (
          <div className="empty">아직 확정한 점주가 없어요.</div>
        ) : (
          <div className="stack">
            {confirmations.map((c) => (
              <div className="resv-conf" key={c.userId}>
                <span className="resv-conf__name">{c.storeName}</span>
                <span className="resv-conf__meta">
                  {c.qty}개 · {won(c.total)}원
                </span>
              </div>
            ))}
          </div>
        )}
        <p className="resv-note" style={{ marginTop: 10 }}>
          예약분은 픽업 전날 발주와 계산서 <b>공구</b>에 자동으로 들어갑니다.
        </p>

        <ReservationBatchDeleteButton batchId={batch.id} />
      </div>
    </>
  );
}
