import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";
import { sumQty } from "@/lib/qty";

const won = (n: number) => n.toLocaleString("ko-KR");

export type ReceiptItem = {
  category: string;
  name: string;
  sub: string; // 예: "3박스 × 36,000"
  amount: number;
};

// 영수증/계산서 — 카테고리별로 묶어 표시. 서버 컴포넌트.
// cats: 분류에 쓸 카테고리 목록. 기본은 주간발주 카탈로그. 일반발주 계산서는 과일/야채/공구/채움채를 넘긴다
// (안 넘기면 일반발주 품목이 전부 '기타'로 빠지는 버그).
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

  const renderGroup = (label: string, list: ReceiptItem[], key: string) => (
    <div className="invcat" key={key}>
      <div className="invcat__head">
        <span className="chip">{label}</span>
        <span className="invcat__sum">
          총 {won(sumQty(list.map((it) => it.sub.split("×")[0])))}개
        </span>
      </div>
      {list.map((it, i) => (
        <div className="invline" key={i}>
          <span>
            <span className="receipt-item__no">{i + 1}</span>
            {it.name}
            <span className="invline__meta">{it.sub}</span>
          </span>
          <span className="invline__amt">{won(it.amount)}원</span>
        </div>
      ))}
    </div>
  );

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
