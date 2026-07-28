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

// 날짜별 계산서 보기용 날짜 이동바. 계산서 date=출고일이라 오늘~근미래(내일 출고분 등)까지 이동.
export function BillingDateBar({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/admin/billing/by-date?date=${d}`);
  const today = kstToday();
  const isToday = date === today;
  const maxDate = shiftDate(today, 7); // 오늘 이후 출고분(계산서)도 조회 가능

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
        <span className="datebar__label">출고 {labelDate(date)}</span>
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
