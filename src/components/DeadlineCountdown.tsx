"use client";

import { useEffect, useState } from "react";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

// 오늘 오후 8시(KST)까지 남은 밀리초
function msUntilDeadline(deadlineHour: number): number {
  const now = Date.now();
  const kst = new Date(now + KST_OFFSET_MS);
  const targetKstWall = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate(),
    deadlineHour,
    0,
    0,
  );
  const targetUtc = targetKstWall - KST_OFFSET_MS;
  return targetUtc - now;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

export function DeadlineCountdown({
  deadlineHour,
  deadlineLabel,
}: {
  deadlineHour: number;
  deadlineLabel: string;
}) {
  const [ms, setMs] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setMs(msUntilDeadline(deadlineHour));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [deadlineHour]);

  // 서버/첫 렌더에서는 빈 자리만 — 하이드레이션 불일치 방지
  if (ms === null) {
    return (
      <div className="countdown" aria-hidden>
        <div className="countdown__label">발주 마감 ({deadlineLabel})까지</div>
        <div className="countdown__time">— : — : —</div>
      </div>
    );
  }

  if (ms <= 0) {
    return (
      <div className="countdown countdown--closed">
        <div className="countdown__label">오늘 발주</div>
        <div className="countdown__time">마감되었어요</div>
      </div>
    );
  }

  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const soon = ms <= 30 * 60 * 1000; // 30분 이내

  return (
    <div className={`countdown ${soon ? "countdown--soon" : ""}`}>
      <div className="countdown__label">발주 마감 ({deadlineLabel})까지</div>
      <div className="countdown__time">
        {h > 0 && (
          <>
            <span className="countdown__num">{pad(h)}</span>
            <span className="countdown__unit">시간</span>
          </>
        )}
        <span className="countdown__num">{pad(m)}</span>
        <span className="countdown__unit">분</span>
        <span className="countdown__num">{pad(s)}</span>
        <span className="countdown__unit">초</span>
      </div>
    </div>
  );
}
