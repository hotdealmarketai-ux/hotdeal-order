"use client";

import { useEffect, useRef } from "react";
import { QTY_UNITS, parseQty, formatQty } from "@/lib/unit";

// 수량 입력 — [−][숫자][+] 스텝퍼 + 단위 칩. 단위는 선택사항(안 고르면 숫자만).
export function QtyField({
  value,
  onChange,
  warn,
}: {
  value: string;
  onChange: (v: string) => void;
  warn?: string;
}) {
  const { num, unit } = parseQty(value);

  // 외부 value가 바뀔 때만 동기화 → 빠른 연타에도 증감이 누락되지 않게 ref로 추적
  const numRef = useRef(num);
  useEffect(() => {
    numRef.current = num;
  }, [num]);

  const bump = (d: number) => {
    const cur = parseInt(numRef.current || "0", 10) || 0;
    const next = Math.max(0, cur + d);
    numRef.current = next === 0 ? "" : String(next);
    onChange(formatQty(numRef.current, unit));
  };

  return (
    <div className="qtyfield">
      <div className="qtyfield__stepper">
        <button
          type="button"
          className="qtystep"
          onClick={() => bump(-1)}
          aria-label="수량 줄이기"
        >
          −
        </button>
        <input
          className="input qtyfield__num"
          inputMode="numeric"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="수량"
        />
        <button
          type="button"
          className="qtystep"
          onClick={() => bump(1)}
          aria-label="수량 늘리기"
        >
          +
        </button>
      </div>
      <div className="qtyfield__units">
        {QTY_UNITS.map((u) => (
          <button
            type="button"
            key={u}
            className={`qtyunit ${unit === u ? "is-on" : ""}`}
            onClick={() => onChange(formatQty(num, unit === u ? "" : u))}
          >
            {u}
          </button>
        ))}
      </div>
      {warn ? (
        <div className="anomwarn">
          <span className="anomwarn__ico" aria-hidden="true">
            !
          </span>
          <span>{warn}</span>
        </div>
      ) : null}
    </div>
  );
}
