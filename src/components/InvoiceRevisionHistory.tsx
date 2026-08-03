import { formatKDateTime } from "@/lib/format";
import {
  revisionCatLabel,
  revisionOp,
  type RevChange,
} from "@/lib/invoice-revision";

// nullish 방어 — 혹시 손상된 changes JSON이 와도 서버 컴포넌트가 500 나지 않게.
const won = (n?: number | null) => (n ?? 0).toLocaleString("ko-KR");

export type RevisionView = {
  id: string;
  createdAt: Date;
  totalBefore: number;
  totalAfter: number;
  changes: RevChange[];
};

function detail(ch: RevChange) {
  if (ch.op === "added" && ch.after)
    return `${ch.after.qty} × ${won(ch.after.unitPrice)} · ${won(ch.after.amount)}원`;
  if (ch.op === "removed" && ch.before)
    return `${ch.before.qty} × ${won(ch.before.unitPrice)} · ${won(ch.before.amount)}원`;
  if (ch.op === "changed" && ch.before && ch.after)
    return `${ch.before.qty}×${won(ch.before.unitPrice)} → ${ch.after.qty}×${won(ch.after.unitPrice)} · ${won(ch.after.amount)}원`;
  return "";
}

// 계산서 수정 내역 — 재발송 시점별로 무엇이 추가/변경/제거됐는지 + 결제요청(미수) 금액 변화.
// 점주·관리자 공용(서버 컴포넌트). 수정 이력이 없으면 아무것도 렌더하지 않는다.
export function InvoiceRevisionHistory({
  revisions,
}: {
  revisions: RevisionView[];
}) {
  if (!revisions || revisions.length === 0) return null;
  return (
    <div className="revhist">
      <div className="revhist__title">수정 내역 ({revisions.length})</div>
      {revisions.map((rev) => {
        const delta = rev.totalAfter - rev.totalBefore;
        return (
          <div className="revcard" key={rev.id}>
            <div className="revcard__head">
              <span className="revcard__time">{formatKDateTime(rev.createdAt)}</span>
              <span className="revcard__amt">
                <span className="revcard__was">{won(rev.totalBefore)}</span>
                <span className="revcard__arrow">→</span>
                <b>{won(rev.totalAfter)}원</b>
                {delta !== 0 && (
                  <span
                    className={`revcard__delta ${delta > 0 ? "is-up" : "is-down"}`}
                  >
                    {delta > 0 ? "+" : "−"}
                    {won(Math.abs(delta))}
                  </span>
                )}
              </span>
            </div>
            {rev.changes.length === 0 ? (
              <div className="revcard__none">금액만 재계산되었어요.</div>
            ) : (
              <div className="revcard__list">
                {rev.changes.map((ch, i) => {
                  const op = revisionOp(ch.op);
                  return (
                    <div className={`revchg ${op.cls}`} key={i}>
                      <div className="revchg__top">
                        <span className="revchg__badge">{op.label}</span>
                        <span className="revchg__name">
                          <span className="revchg__cat">
                            {revisionCatLabel(ch.category)}
                          </span>
                          {ch.name}
                        </span>
                      </div>
                      <div className="revchg__detail">{detail(ch)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
