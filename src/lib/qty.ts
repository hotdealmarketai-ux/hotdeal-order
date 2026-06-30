// 영수증에 표시할 '정리된 수량' 규칙
//  - kg·g(무게), 알(낱개)만 단위를 유지한다
//  - 그 외(숫자·박스·개·단·봉지·망 등)는 숫자 하나로 (기본 단위는 생략)
//  - 다이(크기·등급)는 수량이 아니므로 적힌 그대로 보존
export function displayQty(qty: string): string {
  const q = (qty ?? "").trim();
  if (!q) return "";

  // 무게: kg / g (킬로 / 그램)
  const w = q.match(/(\d+(?:\.\d+)?)\s*(kg|g|킬로그램|킬로|그램)/i);
  if (w) {
    const isKg = /kg|킬로/i.test(w[2]);
    return `${w[1]}${isKg ? "kg" : "g"}`;
  }

  // 낱개: 알 → "N알"
  const al = q.match(/(\d+(?:\.\d+)?)\s*알/);
  if (al) return `${al[1]}알`;

  // 다이(크기·등급)는 수량이 아니므로 그대로
  if (/다이/.test(q)) return q;

  // 그 외(숫자·박스·개·단·봉지·망 등) → 숫자만
  const n = q.match(/\d+(?:\.\d+)?/);
  if (n) return n[0];

  return q;
}
