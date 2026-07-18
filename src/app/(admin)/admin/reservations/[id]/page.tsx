import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { getReservationBatch, getBatchConfirmations } from "@/lib/reservation-data";
import {
  ReservationBatchEditor,
  ReservationBatchDeleteButton,
} from "@/components/ReservationBatchEditor";
import { issueReservationInvoiceAction } from "@/app/actions/reservation";
import { SubmitButton } from "@/components/SubmitButton";
import { labelDate } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");

export default async function EditReservationBatchPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ inv?: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const { inv } = await props.searchParams;
  const batch = await getReservationBatch(id);
  if (!batch) notFound();
  const confirmations = await getBatchConfirmations(batch.id, batch.pickupDate);

  return (
    <>
      <Topbar backHref="/admin/reservations" title={`예약 ${labelDate(batch.reserveDate)}`} />
      <div className="page">
        <ReservationBatchEditor batch={batch} />

        {/* 확정 점주 · 예약 계산서 발행 */}
        <div className="itemshead" style={{ marginTop: 26 }}>
          <span className="itemshead__label">확정한 점주 · 계산서</span>
          <span className="itemshead__count">{confirmations.length}곳</span>
        </div>
        {inv === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 12 }}>
            예약 계산서를 발행했어요.
          </div>
        )}
        {inv === "dup" && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            이 점주의 예약 계산서가 이미 있어요.
          </div>
        )}
        {confirmations.length === 0 ? (
          <div className="empty">아직 확정한 점주가 없어요.</div>
        ) : (
          <div className="stack">
            {confirmations.map((c) => (
              <div className="card resv-card" key={c.userId}>
                <div className="resv-card__main">
                  <div className="resv-card__title">{c.storeName}</div>
                  <div className="resv-card__sub">
                    예약 {c.qty}개 · {won(c.total)}원
                  </div>
                </div>
                {c.invoiced ? (
                  <span className="badge badge--ok">발행됨</span>
                ) : (
                  <form action={issueReservationInvoiceAction}>
                    <input type="hidden" name="batchId" value={batch.id} />
                    <input type="hidden" name="userId" value={c.userId} />
                    <SubmitButton className="btn btn--primary btn--xs" pendingText="발행 중…">
                      계산서 발행
                    </SubmitButton>
                  </form>
                )}
              </div>
            ))}
          </div>
        )}

        <ReservationBatchDeleteButton batchId={batch.id} />
      </div>
    </>
  );
}
