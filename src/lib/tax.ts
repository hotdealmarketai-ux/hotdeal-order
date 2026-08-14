// 과세/면세 + 부가세(VAT 10%) 역산.
// 입력 금액(공급가)은 '부가세 포함' 총액이며, 총액을 그대로 유지한 채
//   세액   = round(총액 / 11)        (= 총액 × 10/110)
//   공급가액 = 총액 - 세액
// 로 쪼갠다 → 공급가액 + 세액 = 총액 이 항상 정확히 일치(반올림 오차 없음).
// 예) 12,000(부가세 포함) → 세액 1,091 + 공급가액 10,909 = 12,000.

export const TAX_TAXABLE = "TAXABLE"; // 과세
export const TAX_EXEMPT = "EXEMPT"; // 면세
export type TaxKind = typeof TAX_TAXABLE | typeof TAX_EXEMPT | "";

export function taxLabel(t: string): string {
  return t === TAX_TAXABLE ? "과세" : t === TAX_EXEMPT ? "면세" : "";
}

// 임의 입력값 → 허용된 tax 값만 통과("TAXABLE"/"EXEMPT"), 그 외는 미선택("").
// 서버·클라이언트 어디서든 tax를 저장하기 전 통과시켜 오염값을 막는다(돈 원칙).
export function normalizeTax(raw: unknown): TaxKind {
  const s = String(raw ?? "").trim();
  return s === TAX_TAXABLE || s === TAX_EXEMPT ? (s as TaxKind) : "";
}

// 카테고리별 과세/면세 기본값 — 과일(FRUIT)·야채(VEG)는 면세 품목이라 자동으로 면세로 잡힌다(관리자가 바꿀 수는 있음).
// 그 외(공구·채움채 등)는 미선택("")으로 두고 관리자가 고른다.
export function defaultTaxFor(category: string): TaxKind {
  return category === "FRUIT" || category === "VEG" ? TAX_EXEMPT : "";
}

// 이 항목이 세금 표시 대상인가 — 과세/면세가 정해진 항목(미선택 제외).
export function hasTax(items: { tax: string }[]): boolean {
  return items.some((it) => it.tax === TAX_TAXABLE || it.tax === TAX_EXEMPT);
}

// 세금계산서(세액·요약) 표시 자격 — 모든 항목이 과세/면세로 분류돼 있어야 한다.
// 하나라도 미선택("")이 남아 있으면 요약을 표시하지 않는다(미선택이 '면세'로 오집계되는 것 차단).
// 발행/재발송 게이트가 미선택 혼합을 막지만, 표시 단에서도 방어(부분 분류 계산서는 세금계산서로 취급 안 함).
export function allTaxClassified(items: { tax: string }[]): boolean {
  return (
    items.length > 0 &&
    items.every((it) => it.tax === TAX_TAXABLE || it.tax === TAX_EXEMPT)
  );
}

// 부가세 포함 총액 → { 공급가액 supply, 세액 vat, 총액 total }.
// 과세만 세액을 뗀다. 면세/미선택은 세액 0(공급가액=총액).
export function vatBreakdown(
  totalInclusive: number,
  taxKind: string,
): { supply: number; vat: number; total: number } {
  const total = Math.round(totalInclusive) || 0;
  if (taxKind !== TAX_TAXABLE) return { supply: total, vat: 0, total };
  const vat = Math.round(total / 11);
  return { supply: total - vat, vat, total };
}

// 계산서(항목 배열) 전체 세금 요약 — 과세/면세 공급가액·세액·합계.
// 각 항목 총액(부가세 포함)에서 항목별로 세액을 떼어 합산(합계는 항상 총액 합과 일치).
export function taxSummary(
  items: { amount: number; tax: string }[],
): { taxableSupply: number; vat: number; exemptSupply: number; total: number } {
  let taxableSupply = 0;
  let vat = 0;
  let exemptSupply = 0;
  let total = 0;
  for (const it of items) {
    const b = vatBreakdown(it.amount, it.tax);
    total += b.total;
    if (it.tax === TAX_TAXABLE) {
      taxableSupply += b.supply;
      vat += b.vat;
    } else {
      exemptSupply += b.total; // 면세·미선택은 공급가액=총액
    }
  }
  return { taxableSupply, vat, exemptSupply, total };
}
