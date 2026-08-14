import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";
import { sumQty } from "@/lib/qty";
import { taxSummary, vatBreakdown, taxLabel, allTaxClassified } from "@/lib/tax";

const won = (n: number) => n.toLocaleString("ko-KR");

export type ReceiptItem = {
  category: string;
  name: string;
  sub: string; // 예: "3박스 × 36,000"
  amount: number;
  tax?: string; // 과세("TAXABLE")/면세("EXEMPT")/미선택("")
};

// 영수증/계산서 — 카테고리별로 묶어 표시. 서버 컴포넌트.
// cats: 분류에 쓸 카테고리 목록. 기본은 주간발주 카탈로그. 일반발주 계산서는 과일/야채/공구/채움채를 넘긴다
// (안 넘기면 일반발주 품목이 전부 '기타'로 빠지는 버그).
// 과세/면세가 지정된 항목이 있으면 항목별 세액 + 세금계산서 요약(과세 공급가액·세액 / 면세 공급가액)을 함께 표시.
export function WeeklyReceipt({
  items,
  totalLabel = "합계",
  band = false,
  cats = WEEKLY_CATEGORIES,
}: {
  items: ReceiptItem[];
  totalLabel?: string;
  band?: boolean; // 총액을 다크 그린 밴드로
  cats?: readonly { key: string; label: string }[];
}) {
  const total = items.reduce((n, it) => n + it.amount, 0);
  const shown = cats.filter((c) => items.some((it) => it.category === c.key));
  // 목록에 없는 카테고리 항목(구 데이터 등)도 빠뜨리지 않게
  const others = items.filter((it) => !shown.some((c) => c.key === it.category));
  // 모든 항목이 과세/면세로 분류돼 있어야 세금계산서(세액) 표시 모드 — 미선택이 하나라도 있으면 미표시(면세 오집계 방지).
  const taxMode = allTaxClassified(items.map((it) => ({ tax: it.tax ?? "" })));
  const summary = taxMode
    ? taxSummary(items.map((it) => ({ amount: it.amount, tax: it.tax ?? "" })))
    : null;

  const renderGroup = (label: string, list: ReceiptItem[], key: string) => {
    // 용달 발송은 수량 개념이 없어 '총 N개' 대신 금액을 헤더에 표시.
    const isFee = key === "DELIVERY";
    const groupAmt = list.reduce((n, it) => n + it.amount, 0);
    return (
      <div className="invcat" key={key}>
        <div className="invcat__head">
          <span className="chip">{label}</span>
          <span className="invcat__sum">
            {isFee
              ? `${won(groupAmt)}원`
              : `총 ${won(sumQty(list.map((it) => it.sub.split("×")[0])))}개`}
          </span>
        </div>
        {list.map((it, i) => {
          const b = it.tax ? vatBreakdown(it.amount, it.tax) : null;
          return (
            <div className="invline" key={i}>
              <span>
                <span className="receipt-item__no">{i + 1}</span>
                {it.name}
                {it.sub && <span className="invline__meta">{it.sub}</span>}
                {taxMode && it.tax && (
                  <span
                    className={`taxtag ${it.tax === "TAXABLE" ? "taxtag--tax" : "taxtag--free"}`}
                  >
                    {taxLabel(it.tax)}
                    {it.tax === "TAXABLE" && b && b.vat > 0 && (
                      <span className="taxtag__vat"> 세액 {won(b.vat)}</span>
                    )}
                  </span>
                )}
              </span>
              <span className="invline__amt">{won(it.amount)}원</span>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div>
      {shown.map((c) =>
        renderGroup(
          c.label,
          items.filter((it) => it.category === c.key),
          c.key,
        ),
      )}
      {others.length > 0 && renderGroup("기타", others, "_others")}

      {/* 세금계산서 요약 — 과세 공급가액·세액 / 면세 공급가액 / 합계(부가세 포함). */}
      {summary && (
        <div className="taxbreak">
          {(summary.taxableSupply > 0 || summary.vat > 0) && (
            <>
              <div className="taxbreak__row">
                <span>과세 공급가액</span>
                <b>{won(summary.taxableSupply)}원</b>
              </div>
              <div className="taxbreak__row">
                <span>세액 (부가세)</span>
                <b>{won(summary.vat)}원</b>
              </div>
            </>
          )}
          {summary.exemptSupply > 0 && (
            <div className="taxbreak__row">
              <span>면세 공급가액</span>
              <b>{won(summary.exemptSupply)}원</b>
            </div>
          )}
        </div>
      )}

      {band ? (
        <div className="grandband">
          <span className="grandband__label">{totalLabel}</span>
          <span className="grandband__amt">{won(total)}원</span>
        </div>
      ) : (
        <div className="invtotal" style={{ marginTop: 8 }}>
          <span>{totalLabel}</span>
          <b>{won(total)}원</b>
        </div>
      )}
    </div>
  );
}
