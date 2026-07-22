"use client";

// 재고현황 이름 검색 입력 (점주·관리자 공용). 값/변경은 부모가 관리.
export function InvSearch({
  value,
  onChange,
  placeholder = "품목명 검색",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="invsearch">
      <svg
        className="invsearch__ic"
        width="17"
        height="17"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <circle cx="11" cy="11" r="7" />
        <path d="M21 21l-4.3-4.3" />
      </svg>
      <input
        className="invsearch__input"
        type="text"
        inputMode="search"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button
          type="button"
          className="invsearch__clear"
          onClick={() => onChange("")}
          aria-label="검색어 지우기"
        >
          ✕
        </button>
      )}
    </div>
  );
}
