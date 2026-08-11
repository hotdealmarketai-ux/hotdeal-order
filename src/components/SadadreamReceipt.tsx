const won = (n: number) => n.toLocaleString("ko-KR");

export type SadadreamLine = { name: string; qty: number; unitPrice: number; amount: number };

// 사다드림 계산서 영수증 — 맨 위 입금계좌(은행/예금주/계좌번호) + 지점명 + 'M월 D일 사다드림 계산서'
// + 품목/수량/단가/금액 + 합계. 우리 계좌가 아닌 개인/개인업체 계좌로 결제 안내.
export function SadadreamReceipt({
  storeName,
  dateLabel,
  bank,
  holder,
  account,
  items,
  paid,
}: {
  storeName: string;
  dateLabel: string;
  bank?: string;
  holder?: string;
  account?: string;
  items: SadadreamLine[];
  paid?: boolean;
}) {
  const total = items.reduce((n, it) => n + it.amount, 0);
  const hasAccount = !!(bank || holder || account);
  return (
    <div className="refundrcpt">
      <div className="refundrcpt__store">
        {storeName}
        {paid && <span className="rectable__adj" style={{ marginLeft: 8 }}>입금완료</span>}
      </div>
      <div className="refundrcpt__sub">{dateLabel} 사다드림 계산서</div>

      {hasAccount && (
        <div className="card" style={{ margin: "10px 0 4px", padding: "12px 14px" }}>
          <div className="section-label" style={{ marginBottom: 6 }}>
            입금계좌
          </div>
          <div className="stack" style={{ gap: 2 }}>
            {(bank || holder) && (
              <div className="spread">
                <span className="row__sub">은행 · 예금주</span>
                <b>{[bank, holder].filter(Boolean).join(" · ")}</b>
              </div>
            )}
            {account && (
              <div className="spread">
                <span className="row__sub">계좌번호</span>
                <b style={{ fontVariantNumeric: "tabular-nums" }}>{account}</b>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="refundrcpt__lines">
        {items.map((it, i) => (
          <div className="refundrcpt__line" key={i}>
            <span className="refundrcpt__name">
              <span className="receipt-item__no">{i + 1}</span>
              {it.name}
              <span className="refundrcpt__meta">
                {it.qty} × {won(it.unitPrice)}
              </span>
            </span>
            <span className="refundrcpt__amt">{won(it.amount)}원</span>
          </div>
        ))}
      </div>
      <div className="refundrcpt__total">
        <span>합계</span>
        <b>{won(total)}원</b>
      </div>
    </div>
  );
}
