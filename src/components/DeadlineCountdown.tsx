// ============================================================
//  DeadlineCountdown — 코발트 교체본
//  위치: src/components/DeadlineCountdown.tsx 교체
//  변경: 안내 문장 삭제 → 라벨 + 큰 시계 + 마감시각 흰 칩
//  로직(스케줄 계산·1초 틱·마감/오픈 상태)은 기존과 동일
// ============================================================

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
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad(h)}시간 ${pad(m)}분 ${pad(sec)}초`;
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

  // SSR/초기 렌더 — 자리 유지
  if (now === null) {
    return (
      <div className="countdown" aria-hidden>
        <div className="countdown__main">
          <span className="countdown__pre">발주 마감까지</span>
          <span className="countdown__clock">--시간 --분 --초</span>
        </div>
        <span className="countdown__chip">{deadlineLabel} 마감</span>
      </div>
    );
  }

  if (isOrderOpen(now)) {
    return (
      <div className="countdown">
        <div className="countdown__main">
          <span className="countdown__pre">발주 마감까지</span>
          <span className="countdown__clock">
            {clock(currentDeadlineUtc(now) - now)}
          </span>
        </div>
        <span className="countdown__chip">{deadlineLabel} 마감</span>
      </div>
    );
  }

  return (
    <div className="countdown countdown--closed">
      <div className="countdown__main">
        <span className="countdown__pre">발주 마감 · 발주 시작까지</span>
        <span className="countdown__clock">{clock(nextOpenUtc(now) - now)}</span>
      </div>
      <span className="countdown__chip">마감됨</span>
    </div>
  );
}
