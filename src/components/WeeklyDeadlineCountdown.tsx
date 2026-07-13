"use client";

import { useEffect, useState } from "react";
import {
  isWeeklyOpen,
  currentWeeklyDeadlineUtc,
  nextWeeklyOpenUtc,
} from "@/lib/schedule";

// 주간발주 헤더 카운트다운 — 일반발주(DeadlineCountdown)와 동일 구조. #12
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

export function WeeklyDeadlineCountdown({
  closeLabel,
  forceOpen = false,
}: {
  closeLabel: string;
  forceOpen?: boolean;
}) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const natural = now !== null && isWeeklyOpen(now);

  // 관리자 임시 오픈(force) & 자연 시간대 아님 → '임시 오픈' 안내
  if (forceOpen && !natural) {
    return (
      <div className="countdown">
        <div className="countdown__main">
          <span className="countdown__pre">주간발주</span>
          <span className="countdown__clock" style={{ fontSize: 19 }}>
            임시 오픈되었습니다
          </span>
        </div>
        <span className="countdown__chip">임시 오픈</span>
      </div>
    );
  }

  if (now === null) {
    return (
      <div className="countdown" aria-hidden>
        <div className="countdown__main">
          <span className="countdown__pre">주간발주 마감까지</span>
          <span className="countdown__clock">--시간 --분 --초</span>
        </div>
        <span className="countdown__chip">{closeLabel} 마감</span>
      </div>
    );
  }

  if (natural) {
    return (
      <div className="countdown">
        <div className="countdown__main">
          <span className="countdown__pre">주간발주 마감까지</span>
          <span className="countdown__clock">
            {clock(currentWeeklyDeadlineUtc(now) - now)}
          </span>
        </div>
        <span className="countdown__chip">{closeLabel} 마감</span>
      </div>
    );
  }

  return (
    <div className="countdown countdown--closed">
      <div className="countdown__main">
        <span className="countdown__pre">마감 · 다음 주간발주까지</span>
        <span className="countdown__clock">{clock(nextWeeklyOpenUtc(now) - now)}</span>
      </div>
      <span className="countdown__chip">마감됨</span>
    </div>
  );
}
