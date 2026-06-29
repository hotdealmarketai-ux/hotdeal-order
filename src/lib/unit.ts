// 수량 단위 판정 — 과일·야채(청과)는 박스가 기본 단위.
//  - 숫자만 → 박스(서버 AI가 자동 변환), 박스/다이 → 박스류, kg·g → 무게: 모두 OK
//  - 그 외 단위(개·알·단·망·봉지 등) → "이거 맞나요?" 되묻기 대상

export function isAcceptedUnit(qty: string): boolean {
  const q = (qty ?? "").trim();
  if (!q) return true;
  if (/^\d+(\.\d+)?$/.test(q)) return true; // 숫자만 → 박스
  if (/박스|다이/.test(q)) return true; // 박스류
  if (/\d\s*(kg|g)\b/i.test(q)) return true; // 10kg, 500g 등
  if (/킬로|그램/.test(q)) return true;
  return false;
}

export function needsUnitConfirm(qty: string): boolean {
  return !isAcceptedUnit(qty);
}

// 숫자만 뽑아 'N박스'로
export function toBoxQty(qty: string): string {
  const m = (qty ?? "").match(/\d+(\.\d+)?/);
  return `${m ? m[0] : "1"}박스`;
}
