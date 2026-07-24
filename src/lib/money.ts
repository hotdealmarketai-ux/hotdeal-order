// 계산서 수량/단가 파싱 — '전체 문자열'이 숫자 형식일 때만 유효(접두 파싱 금지).
// 서버(cleanItems)와 클라이언트(미리보기·검증)가 반드시 같은 규칙을 쓴다.
//  - 허용: "4", "0.5", "1,000", "38,000"  /  거부: "1/2", "3~4", "1,500.00", "-5000", "0,5"

// 소수는 콤마 없는 순수 숫자에만 허용 → "1,500.00"(콤마+소수)은 명세대로 거부.
const QTY_RE = /^(?:\d+(?:\.\d+)?|\d{1,3}(?:,\d{3})+)$/;
const PRICE_RE = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

// 수량: 양수(소수 허용). 형식이 아니면 null.
export function parseQtyStrict(s: string): number | null {
  const t = (s ?? "").trim();
  if (!QTY_RE.test(t)) return null;
  const n = parseFloat(t.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// 단가: 0 이상 정수(원). 형식이 아니면 null.
export function parsePriceStrict(s: string): number | null {
  const t = (s ?? "").trim();
  if (!PRICE_RE.test(t)) return null;
  const n = parseInt(t.replace(/,/g, ""), 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
