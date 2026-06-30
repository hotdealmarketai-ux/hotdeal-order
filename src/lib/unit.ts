// 수량 문자열 유틸 — '숫자만'과 '숫자+단위'를 구분만 한다(박스 자동변환 없음).
//  - 스텝퍼/단위 칩이 쓰는 파싱·조합 helper
//  - 이상 수량(평소보다 훨씬 많음) 경고

// 단위 칩에 노출할 자주 쓰는 단위
export const QTY_UNITS = ["박스", "다이", "개", "단", "kg"];

// "30박스" -> { num: "30", unit: "박스" }, "30" -> { num: "30", unit: "" }
export function parseQty(qty: string): { num: string; unit: string } {
  const q = (qty ?? "").trim();
  const m = q.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
  if (!m) return { num: "", unit: q };
  return { num: m[1], unit: (m[2] ?? "").trim() };
}

// 숫자 + 단위 조합. 숫자가 없으면 단위(또는 원문)만, 단위가 없으면 숫자만.
export function formatQty(num: string, unit: string): string {
  const n = (num ?? "").trim();
  const u = (unit ?? "").trim();
  if (!n) return u;
  return u ? `${n}${u}` : n;
}

// 수량 문자열에서 맨 앞 숫자만 뽑기(없으면 null)
export function qtyNumber(qty: string): number | null {
  const m = (qty ?? "").match(/\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

// 품목명 매칭 키(공백 제거·소문자)
export function itemKey(name: string): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

// 과거 발주에서 품목별 '평소 수량'(중앙값)을 만든다. 2회 이상 시킨 품목만(노이즈 방지).
export function buildTypicals(
  items: {
    name?: string | null;
    rawName?: string | null;
    rawQty?: string | null;
    qty?: string | null;
  }[],
): Record<string, number> {
  const groups: Record<string, number[]> = {};
  for (const it of items) {
    const n = qtyNumber(it.rawQty || it.qty || "");
    if (n == null) continue;
    for (const nm of [it.rawName, it.name]) {
      const k = itemKey(nm || "");
      if (!k) continue;
      (groups[k] ||= []).push(n);
    }
  }
  const out: Record<string, number> = {};
  for (const k in groups) {
    const arr = groups[k].sort((a, b) => a - b);
    if (arr.length < 2) continue; // 한 번만 시킨 품목은 기준이 부족 → 경고 안 함
    out[k] = arr[Math.floor(arr.length / 2)]; // 중앙값
  }
  return out;
}

// 이상 수량 경고 메시지(평소보다 훨씬 많으면) — 아니면 빈 문자열
export function anomalyMessage(
  qty: string,
  typical: number | undefined,
): string {
  if (!typical || typical <= 0) return "";
  const n = qtyNumber(qty);
  if (n == null) return "";
  // 평소의 3배 이상이고, 절대 차이도 5 이상일 때만(1→4 같은 건 무시)
  if (n >= typical * 3 && n - typical >= 5) {
    const base = Number.isInteger(typical)
      ? String(typical)
      : typical.toFixed(0);
    return `평소엔 ${base}쯤 시키셨어요. ${qty.trim()} 맞을까요?`;
  }
  return "";
}
