// ============================================================
//  함께 출고되는 공산품(읽기 전용 카드) — 그 발주창 출고일에 같이 나가는 확정 공산품
//  · 제한 모드 발주 폼(공구 탭 대신, OrderForm)·발주 뒤 /order·하루 상세(/order/day/[date])가 같이 쓴다.
//  · 숫자는 getReservationLoadForShipment(출고·계산서와 같은 확정 조건) 그대로 — 화면 숫자 = 계산서 숫자.
//  · 줄이 없으면 아무것도 그리지 않는다. 클라이언트 훅이 없어 서버·클라이언트 어디서나 쓸 수 있다.
//  · 모양은 order-plan-form.css(.shipgoods*) — 쓰는 화면이 그 CSS 를 불러온다.
// ============================================================

import Link from "next/link";

/** 카드 한 줄. 확정 공산품은 정수 수량, 모드 전에 넣은 공구 발주 줄(legacy)은 발주에 적힌 수량 문자열(그대로 나감). */
export type ShipGoodsLine = { name: string; qty: string | number; legacy?: boolean };

function qtyLabel(q: string | number): string {
  const t = String(q ?? "").trim();
  return /^\d+$/.test(t) ? `${t}개` : t;
}

export function ShipGoodsCard({
  shipLabel,
  lines,
  href = "",
}: {
  shipLabel: string; // 출고일 라벨 "10월 20일 (화)"
  lines: ShipGoodsLine[];
  href?: string; // 공산품 화면(공산품이 안 보이는 지점이면 빈 값 → 링크 없음)
}) {
  if (lines.length === 0) return null;
  // 모드 전에 넣은 공구 발주 줄은 공산품이 아니다(공산품 화면에 없음) → 건수·링크에서 빼고 아래에 따로 보인다.
  const goods = lines.filter((l) => !l.legacy);
  const old = lines.filter((l) => l.legacy);
  const list = (rows: ShipGoodsLine[], key: string) => (
    <ul className="shipgoods__list">
      {rows.map((l, i) => (
        <li className="shipgoods__item" key={`${key}${i}`}>
          <span className="shipgoods__name">{l.name}</span>
          <span className="shipgoods__qty">{qtyLabel(l.qty)}</span>
        </li>
      ))}
    </ul>
  );
  const title = (
    <span className="shipgoods__titlebox">
      <span className="shipgoods__title">
        함께 출고되는 공산품 <b>{goods.length}건</b>
      </span>
      {shipLabel && <span className="shipgoods__sub">{shipLabel} 출고</span>}
    </span>
  );
  return (
    <section className="shipgoods" aria-label="함께 출고되는 공산품">
      {goods.length > 0 &&
        (href ? (
          <Link href={href} className="shipgoods__head">
            {title}
            <span className="shipgoods__go">수정 ›</span>
          </Link>
        ) : (
          <div className="shipgoods__head">{title}</div>
        ))}
      {goods.length > 0 && list(goods, "sg")}
      {old.length > 0 && (
        <div className="shipgoods__head shipgoods__head--old">
          <span className="shipgoods__title">
            이전 공구 발주 <b>{old.length}건</b>
          </span>
        </div>
      )}
      {old.length > 0 && list(old, "lg")}
    </section>
  );
}
