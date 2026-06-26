"use client";

import { useRouter } from "next/navigation";
import { kstToday, shiftDate } from "@/lib/date";

export function VendorDateBar({ date }: { date: string }) {
  const router = useRouter();
  const go = (d: string) => router.push(`/vendor?date=${d}`);
  const isToday = date === kstToday();

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
      <input
        type="date"
        className="datebar__input"
        value={date}
        max={kstToday()}
        onChange={(e) => e.target.value && go(e.target.value)}
      />
      <button
        type="button"
        className="datebar__arrow"
        onClick={() => go(shiftDate(date, 1))}
        aria-label="다음 날"
      >
        ›
      </button>
      {!isToday && (
        <button
          type="button"
          className="btn btn--xs btn--soft"
          onClick={() => go(kstToday())}
        >
          오늘
        </button>
      )}
    </div>
  );
}
