// ============================================================
//  공산품(상시 예약 상품) 수량 규칙 — 점주 화면 · 점주 저장 · 관리자 경고가 같은 계산을 쓴다.
//  · minPerStore : 지점당 최소 수량(MOQ, null = 없음). 최소 이상이면 몇 개를 넣든 상관없다.
//  · 0 = 취소라 항상 허용. 검사는 '수량이 바뀔 때만'(편성 줄 최소 수량과 같은 규칙 — 나중에 최소를
//    올려도 이미 들어온 줄은 그대로 둔다).
//  (2026-10-17 '발주 단위(몇 개씩)'는 없애고 최소 수량 하나로 합쳤다 — 옛 qtyStep 칸은 DB 에만 남아 있고 안 쓴다)
//  순수 함수만 — 서버·클라이언트 어디서나 가져다 쓴다.
// ============================================================

export type FlatQtyRule = { minPerStore: number | null };

/** 점주 안내 한 줄 최대 글자 수 */
export const FLAT_DESC_MAX = 60;

/** 실제 최소 — 최소가 없으면 1 */
export function effectiveMin(rule: FlatQtyRule): number {
  return rule.minPerStore && rule.minPerStore > 1 ? rule.minPerStore : 1;
}

/** 최소 수량이 있는 상품인가(배지·안내 표시용) */
export function hasQtyRule(rule: FlatQtyRule): boolean {
  return (rule.minPerStore ?? 0) > 1;
}

/**
 * 점주 수량 검사 — 막아야 하면 점주에게 보일 문구, 통과면 null.
 * prev = 지금 저장돼 있는 내 수량(없으면 0). 수량이 그대로면 검사하지 않는다.
 */
export function flatQtyProblem(qty: number, prev: number, rule: FlatQtyRule): string | null {
  if (!Number.isInteger(qty) || qty < 0) return "수량은 숫자로 넣어 주세요.";
  if (qty === 0 || qty === prev) return null;
  const min = effectiveMin(rule);
  if (qty < min) return `최소 주문수량은 ${min}개예요.`;
  return null;
}

/** [+] 한 번 — 0에서는 최소 수량으로, 그다음은 1씩 */
export function stepUp(qty: number, rule: FlatQtyRule): number {
  const min = effectiveMin(rule);
  return qty < min ? min : qty + 1;
}

/** [−] 한 번 — 최소 밑으로 내려가면 0(취소) */
export function stepDown(qty: number, rule: FlatQtyRule): number {
  if (qty <= 0) return 0;
  const next = qty - 1;
  return next >= effectiveMin(rule) ? next : 0;
}

/** 배지 문구 — ['최소 주문수량 5개'] (최소 수량이 없으면 빈 배열) */
export function qtyRuleBadges(rule: FlatQtyRule): string[] {
  return hasQtyRule(rule) ? [`최소 주문수량 ${rule.minPerStore}개`] : [];
}

/** 관리자 입력 해석 — 최소: 빈칸·0·1 = 없음(null). 잘못된 값은 오류 문구 */
export function parseMinInput(raw: string): { value: number | null } | { error: string } {
  const t = raw.trim();
  if (t === "") return { value: null };
  if (!/^\d+$/.test(t)) return { error: "최소 주문수량은 숫자로 넣어 주세요." };
  const n = Number(t);
  if (n > 99999) return { error: "최소 주문수량이 너무 커요." };
  return { value: n <= 1 ? null : n };
}
