"use client";

// 금액 입력 — 화면엔 천단위 콤마(1,000)로 보이고, 부모가 들고 있는 값/폼 제출 값은 '숫자만'.
// value 는 숫자 문자열("1000"), onChange 는 숫자만 남긴 문자열을 돌려준다(콤마·기호 제거).
export function MoneyInput({
  value,
  onChange,
  placeholder,
  className = "input",
  id,
  name,
  disabled,
}: {
  value: string;
  onChange: (raw: string) => void;
  placeholder?: string;
  className?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
}) {
  const digits = (value ?? "").replace(/[^\d]/g, "");
  const display = digits === "" ? "" : Number(digits).toLocaleString("ko-KR");
  return (
    <input
      id={id}
      name={name}
      className={className}
      inputMode="numeric"
      value={display}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ""))}
    />
  );
}
