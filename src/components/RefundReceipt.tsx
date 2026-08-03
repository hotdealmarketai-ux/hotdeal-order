const won = (n: number) => n.toLocaleString("ko-KR");

export type RefundLine = { name: string; qty: number; unitPrice: number; amount: number };

// 환불계산서 영수증 — 카테고리 없이 상단 지점명 + 'M월 D일 환불계산서' + 품목/수량/단가/금액 + 환불 총액.
// (일반 계산서와 달리 재고·카테고리·발주 참고 없음. 순수 자유입력 표시.)
export function RefundReceipt({
  storeName,
  dateLabel,
  items,
  note,
}: {
  storeName: string;
  dateLabel: string; // 예: "8월 4일 (화)"
  items: RefundLine[];
  note?: string;
}) {
  const total = items.reduce((n, it) => n + it.amount, 0);
  return (
    <div className="refundrcpt">
      <div className="refundrcpt__store">{storeName}</div>
      <div className="refundrcpt__sub">{dateLabel} 환불계산서</div>
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
        <span>환불 총액</span>
        <b>{won(total)}원</b>
      </div>
      {note && <div className="refundrcpt__note">{note}</div>}
    </div>
  );
}
