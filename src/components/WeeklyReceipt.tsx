import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";

const won = (n: number) => n.toLocaleString("ko-KR");

export type ReceiptItem = {
  category: string;
  name: string;
  sub: string; // 예: "3박스 × 36,000"
  amount: number;
};

// 주간발주 영수증/계산서 — 카테고리별로 묶어 표시. 서버 컴포넌트.
export function WeeklyReceipt({
  items,
  totalLabel = "합계",
}: {
  items: ReceiptItem[];
  totalLabel?: string;
}) {
  const total = items.reduce((n, it) => n + it.amount, 0);
  const cats = WEEKLY_CATEGORIES.filter((c) =>
    items.some((it) => it.category === c.key),
  );
  // 카탈로그 카테고리에 없는 항목(예: 구 데이터)도 빠뜨리지 않게
  const others = items.filter((it) => !cats.some((c) => c.key === it.category));

  const renderGroup = (label: string, list: ReceiptItem[], key: string) => (
    <div className="invcat" key={key}>
      <div className="invcat__head">
        <span className="chip">{label}</span>
        <span className="invcat__sum">{list.length}개</span>
      </div>
      {list.map((it, i) => (
        <div className="invline" key={i}>
          <span>
            {it.name}
            <span className="invline__meta">{it.sub}</span>
          </span>
          <span className="invline__amt">{won(it.amount)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {cats.map((c) =>
        renderGroup(
          c.label,
          items.filter((it) => it.category === c.key),
          c.key,
        ),
      )}
      {others.length > 0 && renderGroup("기타", others, "_others")}
      <div className="invtotal" style={{ marginTop: 8 }}>
        <span>{totalLabel}</span>
        <b>{won(total)}원</b>
      </div>
    </div>
  );
}
