import { formatKDateTime } from "@/lib/format";

export type ReservationChangeEntry = {
  id: string;
  actorName: string;
  changes: { name: string; op: "changed" | "removed"; before: number; after: number }[];
  createdAt: Date;
};

// 본사(관리자)가 이 점포의 예약 수량을 수정한 내역 — 점주 열람용(서버 컴포넌트).
// 계산서 수정 내역(InvoiceRevisionHistory)과 같은 .revhist 스타일을 재사용.
export function ReservationChangeHistory({
  entries,
}: {
  entries: ReservationChangeEntry[];
}) {
  if (!entries || entries.length === 0) return null;
  return (
    <div className="revhist">
      <div className="revhist__title">본사 수정 내역 ({entries.length})</div>
      {entries.map((e) => (
        <div className="revcard" key={e.id}>
          <div className="revcard__head">
            <span className="revcard__time">{formatKDateTime(e.createdAt)}</span>
            <span className="revcard__time">{e.actorName || "본사"}</span>
          </div>
          {e.changes.length === 0 ? (
            <div className="revcard__none">예약 내용이 조정되었어요.</div>
          ) : (
            <div className="revcard__list">
              {e.changes.map((c, i) => (
                <div
                  className={`revchg ${c.op === "removed" ? "revchg--del" : "revchg--chg"}`}
                  key={i}
                >
                  <div className="revchg__top">
                    <span className="revchg__badge">
                      {c.op === "removed" ? "삭제" : "변경"}
                    </span>
                    <span className="revchg__name">{c.name}</span>
                  </div>
                  <div className="revchg__detail">
                    {c.op === "removed"
                      ? `${c.before}개 → 삭제`
                      : `${c.before}개 → ${c.after}개`}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
