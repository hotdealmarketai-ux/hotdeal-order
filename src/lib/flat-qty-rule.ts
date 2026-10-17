// ============================================================
//  공산품(상시 예약 상품) 수량 규칙 — 점주 화면 · 점주 저장 · 관리자 경고가 같은 계산을 쓴다.
//  · minPerStore : 지점당 최소(null = 없음)
//  · qtyStep     : 몇 개씩(배수). 1 = 낱개
//  · 실제 최소 = minPerStore ?? (qtyStep > 1 ? qtyStep : 1)
//  · 0 = 취소라 항상 허용. 검사는 '수량이 바뀔 때만'(편성 줄 최소 수량과 같은 규칙 — 나중에 최소를
//    올려도 이미 들어온 줄은 그대로 둔다).
//  순수 함수만 — 서버·클라이언트 어디서나 가져다 쓴다.
// ============================================================

export type FlatQtyRule = { minPerStore: number | null; qtyStep: number };

/** 점주 안내 한 줄 최대 글자 수 */
export const FLAT_DESC_MAX = 60;

function step(rule: FlatQtyRule): number {
  return Number.isInteger(rule.qtyStep) && rule.qtyStep > 1 ? rule.qtyStep : 1;
}

/** 실제 최소 — 최소가 없으면 몇 개씩(2 이상일 때), 둘 다 없으면 1 */
export function effectiveMin(rule: FlatQtyRule): number {
  const s = step(rule);
  const m = rule.minPerStore && rule.minPerStore > 1 ? rule.minPerStore : 0;
  return Math.max(m, s, 1);
}

/** 규칙이 있는 상품인가(배지·안내 표시용) */
export function hasQtyRule(rule: FlatQtyRule): boolean {
  return step(rule) > 1 || (rule.minPerStore ?? 0) > 1;
}

/**
 * 점주 수량 검사 — 막아야 하면 점주에게 보일 문구, 통과면 null.
 * prev = 지금 저장돼 있는 내 수량(없으면 0). 수량이 그대로면 검사하지 않는다.
 */
export function flatQtyProblem(qty: number, prev: number, rule: FlatQtyRule): string | null {
  if (!Number.isInteger(qty) || qty < 0) return "수량은 숫자로 넣어 주세요.";
  if (qty === 0 || qty === prev) return null;
  const s = step(rule);
  const min = effectiveMin(rule);
  if (qty < min) return `${min}개부터 발주할 수 있어요.`;
  if (s > 1 && qty % s !== 0) return `${s}개씩 발주할 수 있어요.`;
  return null;
}

/** [+] 한 번 — 0에서는 실제 최소로, 그다음은 몇 개씩만큼 */
export function stepUp(qty: number, rule: FlatQtyRule): number {
  const s = step(rule);
  const min = effectiveMin(rule);
  if (qty < min) return min;
  // 배수가 아닌 옛 수량(예: 7, 5개씩)은 다음 배수로 맞춘다
  if (s > 1 && qty % s !== 0) return Math.ceil(qty / s) * s;
  return qty + s;
}

/** [−] 한 번 — 최소 밑으로 내려가면 0(취소) */
export function stepDown(qty: number, rule: FlatQtyRule): number {
  const s = step(rule);
  const min = effectiveMin(rule);
  if (qty <= 0) return 0;
  if (s > 1 && qty % s !== 0) {
    const down = Math.floor(qty / s) * s;
    return down >= min ? down : 0;
  }
  const next = qty - s;
  return next >= min ? next : 0;
}

/** 배지 문구 — ['5개부터'] / ['5개씩'] / ['5개부터', '5개씩'] (최소가 몇 개씩과 같으면 '5개씩' 하나) */
export function qtyRuleBadges(rule: FlatQtyRule): string[] {
  const s = step(rule);
  const m = rule.minPerStore && rule.minPerStore > 1 ? rule.minPerStore : 0;
  const out: string[] = [];
  if (m > 0 && m !== s) out.push(`${m}개부터`);
  if (s > 1) out.push(`${s}개씩`);
  return out;
}

/** 관리자 입력 해석 — 최소: 빈칸·0·1 = 없음(null). 잘못된 값은 오류 문구 */
export function parseMinInput(raw: string): { value: number | null } | { error: string } {
  const t = raw.trim();
  if (t === "") return { value: null };
  if (!/^\d+$/.test(t)) return { error: "최소 수량은 숫자로 넣어 주세요." };
  const n = Number(t);
  if (n > 99999) return { error: "최소 수량이 너무 커요." };
  return { value: n <= 1 ? null : n };
}

/** 관리자 입력 해석 — 몇 개씩: 빈칸·0 = 1(낱개). 잘못된 값은 오류 문구 */
export function parseStepInput(raw: string): { value: number } | { error: string } {
  const t = raw.trim();
  if (t === "") return { value: 1 };
  if (!/^\d+$/.test(t)) return { error: "발주 단위는 숫자로 넣어 주세요." };
  const n = Number(t);
  if (n > 9999) return { error: "발주 단위가 너무 커요." };
  return { value: n <= 0 ? 1 : n };
}

/** 최소·몇 개씩 함께 검사 — 최소는 몇 개씩의 배수여야 한다(5개씩인데 최소 7 이면 7을 넣을 수 없음) */
export function ruleProblem(rule: FlatQtyRule): string | null {
  const s = step(rule);
  if (rule.minPerStore && rule.minPerStore > 1 && s > 1 && rule.minPerStore % s !== 0) {
    return `최소 수량은 발주 단위(${s}개씩)의 배수로 넣어 주세요.`;
  }
  return null;
}
