"use client";

// 발주 수령 방식 선택기(직접 픽업 / 배송) — 핫딜마켓 가맹점 전용.
// 기본값 없음: 하나를 눌러야 발주 가능(미선택 상태를 시각적으로 프롬프트).
// 배송 선택 시 등록된 매장 주소를 자동 배송지로 표시(따로 입력 안 받음).
// hidden input(name="fulfillment")을 폼 안에 함께 렌더해 서버로 전달.

import { FULFILLMENT_LABEL, type Fulfillment } from "@/lib/constants";

const OPTS: { key: Fulfillment; icon: React.ReactNode }[] = [
  {
    key: "PICKUP",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 8h12l-1 11.2A1 1 0 0 1 16 20H8a1 1 0 0 1-1-.8L6 8Z" />
        <path d="M9 8a3 3 0 0 1 6 0" />
      </svg>
    ),
  },
  {
    key: "DELIVERY",
    icon: (
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2.5 7h11v9h-11z" />
        <path d="M13.5 10h4l3 3v3h-7z" />
        <circle cx="7" cy="18.5" r="1.7" />
        <circle cx="17.5" cy="18.5" r="1.7" />
      </svg>
    ),
  },
];

export function FulfillmentPicker({
  value,
  onChange,
  address = "",
  disabled = false,
}: {
  value: "" | Fulfillment;
  onChange: (v: Fulfillment) => void;
  address?: string;
  disabled?: boolean;
}) {
  return (
    <div className="fulfill">
      <input type="hidden" name="fulfillment" value={value} />
      <div className="fulfill__label">
        수령 방식
        {!value && <span className="fulfill__req">선택해 주세요</span>}
      </div>
      <div className="fulfill__seg" role="radiogroup" aria-label="수령 방식">
        {OPTS.map((o) => (
          <button
            type="button"
            key={o.key}
            role="radio"
            aria-checked={value === o.key}
            className={`fulfill__opt ${value === o.key ? "is-active" : ""}`}
            onClick={() => onChange(o.key)}
            disabled={disabled}
          >
            {o.icon}
            <span>{FULFILLMENT_LABEL[o.key]}</span>
          </button>
        ))}
      </div>
      {value === "DELIVERY" && (
        <div className="fulfill__addr">
          <span className="fulfill__addrk">배송지</span>
          <span className="fulfill__addrv">{address || "등록된 매장 주소"}</span>
        </div>
      )}
    </div>
  );
}
