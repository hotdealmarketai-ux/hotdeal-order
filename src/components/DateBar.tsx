"use client";

import { useRouter } from "next/navigation";
import { kstToday, shiftDate, labelDate } from "@/lib/date";

function CalIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17M8 3v3M16 3v3" />
    </svg>
  );
}

// 범용 날짜 선택바 — basePath/추가 쿼리(scope 등)를 보존. 날짜 선택은 숨긴 date input이 담당(기능 불변).
// labelPrefix: "출고 " 등 라벨 접두사. max: 선택 가능한 상한(출고일 목록은 오늘 발주의 출고일까지 허용).
export function DateBar({
  date,
  basePath,
  query,
  labelPrefix = "",
  max,
}: {
  date: string;
  basePath: string;
  query?: string;
  labelPrefix?: string;
  max?: string;
}) {
  const router = useRouter();
  const suffix = query ? `&${query}` : "";
  const go = (d: string) => router.push(`${basePath}?date=${d}${suffix}`);
  const today = kstToday();
  const isToday = date === today;
  const maxDate = max ?? today;

  return (
    <div className="datebar">
      <button
        type="button"
        className="datebar__arrow"
        onClick={() => go(shiftDate(date, -1))}
        aria-label="이전 날"
      >
        ‹
      </button>
      <div className="datebar__center">
        <span className="datebar__label">{labelPrefix}{labelDate(date)}</span>
        <span className="datebar__cal" aria-label="날짜 선택">
          <CalIcon />
          <input
            type="date"
            value={date}
            max={maxDate}
            onChange={(e) => e.target.value && go(e.target.value)}
          />
        </span>
      </div>
      <button
        type="button"
        className="datebar__arrow"
        onClick={() => go(shiftDate(date, 1))}
        disabled={date >= maxDate}
        aria-label="다음 날"
      >
        ›
      </button>
      {!isToday && (
        <button
          type="button"
          className="btn btn--xs btn--soft"
          onClick={() => go(today)}
        >
          오늘
        </button>
      )}
    </div>
  );
}
