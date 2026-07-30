// 입고 기록 표시용 공통 타입/포맷터. ("use server" 아님 — 동기 export 허용, 서버·클라 양쪽에서 타입 공유)

export type InboundRow = {
  id: string;
  name: string;
  qty: number;
  supplyPrice: number;
  expiry: string; // 유통기한 YYYY-MM-DD(빈값=없음)
  majorCat: string; // 카테고리(대분류)
  minorCat: string; // 카테고리(중분류)
  at: string; // 입고시간 — KST "YY-MM-DD HH:MM"
  createdAtMs: number; // 입고 시각(epoch ms) — 삭제 시 '1시간 이내' 판정(재고 되돌림 여부)용
};

// 입고시간 표시 — KST(UTC+9) "YY-MM-DD HH:MM". createdAt은 불변이라 서버에서 미리 문자열로 만들어 보낸다.
function fmtInboundAt(d: Date): string {
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${String(k.getUTCFullYear()).slice(2)}-${p(k.getUTCMonth() + 1)}-${p(
    k.getUTCDate(),
  )} ${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
}

export function toInboundRow(r: {
  id: string;
  name: string;
  qty: number;
  supplyPrice: number;
  expiry: string;
  majorCat: string;
  minorCat: string;
  createdAt: Date;
}): InboundRow {
  return {
    id: r.id,
    name: r.name,
    qty: r.qty,
    supplyPrice: r.supplyPrice,
    expiry: r.expiry,
    majorCat: r.majorCat,
    minorCat: r.minorCat,
    at: fmtInboundAt(r.createdAt),
    createdAtMs: r.createdAt.getTime(),
  };
}
