"use client";

// 계산서 항목의 과세/면세 선택기 — 계산서 발행폼·수정폼·주간발주 행에서 공통 사용.
// 한 번 고르면 항상 유효값이 되도록 '세팅 전용'(과세 누르면 TAXABLE, 면세 누르면 EXEMPT).
// 연동 재고 품목은 하드코딩된 값이 미리 선택돼 오고, 여기서 바꿀 수 있다.
export function TaxToggle({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (v: "TAXABLE" | "EXEMPT") => void;
  disabled?: boolean;
}) {
  return (
    <span className="taxsel" role="group" aria-label="과세 면세 선택">
      <button
        type="button"
        className={`taxsel__b${value === "TAXABLE" ? " is-on" : ""}`}
        aria-pressed={value === "TAXABLE"}
        disabled={disabled}
        onClick={() => onChange("TAXABLE")}
      >
        과세
      </button>
      <button
        type="button"
        className={`taxsel__b taxsel__b--free${value === "EXEMPT" ? " is-on" : ""}`}
        aria-pressed={value === "EXEMPT"}
        disabled={disabled}
        onClick={() => onChange("EXEMPT")}
      >
        면세
      </button>
    </span>
  );
}
