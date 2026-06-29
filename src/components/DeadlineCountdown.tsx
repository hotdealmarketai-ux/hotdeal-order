"use client";

import { useEffect, useState } from "react";
import {
  isOrderOpen,
  currentDeadlineUtc,
  nextOpenUtc,
} from "@/lib/schedule";

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function DeadlineCountdown({
  deadlineLabel,
}: {
  deadlineLabel: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  if (now === null) {
    return (
      <div className="countdown" aria-hidden>
        <div className="countdown__label">금일 발주 마감은 {deadlineLabel} 입니다.</div>
        <div className="countdown__time">
          <span className="countdown__pre">발주 마감까지</span>
          <span className="countdown__clock">--:--:--</span>
        </div>
      </div>
    );
  }

  if (isOrderOpen(now)) {
    return (
      <div className="countdown">
        <div className="countdown__label">금일 발주 마감은 {deadlineLabel} 입니다.</div>
        <div className="countdown__time">
          <span className="countdown__pre">발주 마감까지</span>
          <span className="countdown__clock">{clock(currentDeadlineUtc(now) - now)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="countdown countdown--closed">
      <div className="countdown__label">발주가 마감되었습니다</div>
      <div className="countdown__time">
        <span className="countdown__pre">발주 시작까지</span>
        <span className="countdown__clock">{clock(nextOpenUtc(now) - now)}</span>
        <span className="countdown__pre">남았습니다</span>
      </div>
    </div>
  );
}
