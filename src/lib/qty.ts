// 수량 문자열에서 앞의 숫자만 추출(콤마 제거). 숫자 없으면 0.
export function qtyNum(qty: string): number {
  const m = (qty ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : 0;
}

// 카테고리 총 수량(박스 세기용) — 수량 숫자만 합산. 소수 오차 정리.
export function sumQty(qtys: string[]): number {
  const t = qtys.reduce((s, q) => s + qtyNum(q), 0);
  return Math.round(t * 1000) / 1000;
}

// 영수증에 표시할 '정리된 수량' 규칙
//  - 다이(크기·등급)는 수량이 아니라 '설명'이므로 수량에서 제거(비고로 감)
//  - 그 외 뒤에 붙는 단위(박스·개·단·봉지·망·통·kg·g·알 등)는 모두 떼고 '숫자'만 남긴다
//  - 숫자가 아예 없으면(예: "한 박스") 원문을 그대로 둔다(정보 손실 방지)
export function displayQty(qty: string): string {
  let q = (qty ?? "").trim();
  if (!q) return "";

  // 다이(크기·등급) 설명은 수량이 아니므로 떼어낸다. (예: "3다이 전반 4박스" → "4박스")
  q = q
    .replace(/\d+(?:\.\d+)?\s*다이(\s*(전반|후반|중반))?/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return ""; // 다이 설명만 있었으면 수량 없음

  // 뒤에 붙는 단위(박스·망·단·개·봉지·통·kg·알 등)는 모두 떼고 '숫자'만 남긴다.
  const n = q.match(/\d+(?:\.\d+)?/);
  if (n) return n[0];

  // 숫자가 없으면 원문 유지
  return q;
}
