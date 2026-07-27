"use client";

import { useEffect, useState } from "react";
import { reservationDeadlineUtc } from "@/lib/reservation";
import { labelDate } from "@/lib/date";

// 예약발주 마감 카운트다운 — 일반발주와 동일하게 예약일 저녁 8시(토요일은 일요일 20시)가 마감.
function pad(n: number) {
  return String(n).padStart(2, "0");
}
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return d > 0
    ? `${d}일 ${pad(h)}시간 ${pad(m)}분`
    : `${pad(h)}시간 ${pad(m)}분 ${pad(sec)}초`;
}

export function ReservationDeadlineCountdown({
  reserveDate,
  pickupDates,
}: {
  reserveDate: string;
  pickupDates: string[];
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const deadline = reservationDeadlineUtc(reserveDate).getTime();
  // 픽업이 상품별 → 여러 날짜. 칩엔 개수만 간결히(상세는 아래 날짜 블록/상품별 표기).
  const pickup =
    pickupDates.length <= 1
      ? `픽업 ${pickupDates[0] ? labelDate(pickupDates[0]) : "-"}`
      : `픽업 ${pickupDates.length}일`;

  if (now === null) {
    return (
      <div className="countdown" aria-hidden>
        <div className="countdown__main">
          <span className="countdown__pre">예약 마감까지</span>
          <span className="countdown__clock">--시간 --분 --초</span>
        </div>
        <span className="countdown__chip">{pickup}</span>
      </div>
    );
  }

  if (now >= deadline) {
    return (
      <div className="countdown countdown--closed">
        <div className="countdown__main">
          <span className="countdown__pre">예약이 마감되었습니다</span>
          <span className="countdown__clock" style={{ fontSize: 19 }}>
            {pickup}
          </span>
        </div>
        <span className="countdown__chip">마감됨</span>
      </div>
    );
  }

  return (
    <div className="countdown">
      <div className="countdown__main">
        <span className="countdown__pre">예약 마감까지</span>
        <span className="countdown__clock">{clock(deadline - now)}</span>
      </div>
      <span className="countdown__chip">{pickup}</span>
    </div>
  );
}
