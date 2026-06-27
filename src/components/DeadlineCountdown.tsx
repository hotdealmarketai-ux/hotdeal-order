"use client";

import { useEffect, useState } from "react";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function kstParts(now: number) {
  const d = new Date(now + KST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    da: d.getUTCDate(),
    h: d.getUTCHours(),
  };
}

// (KST 벽시계 y-mo-da-h) 에 해당하는 실제 UTC 인스턴트
function targetUtc(y: number, mo: number, da: number, h: number) {
  return Date.UTC(y, mo, da, h, 0, 0) - KST_OFFSET_MS;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function clock(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function DeadlineCountdown({
  openHour,
  closeHour,
  deadlineLabel,
}: {
  openHour: number;
  closeHour: number;
  deadlineLabel: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // 첫 렌더(서버/하이드레이션)에는 시계 숨김 — 불일치 방지
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

  const { y, mo, da, h } = kstParts(now);
  const open = h >= openHour && h < closeHour;

  if (open) {
    const target = targetUtc(y, mo, da, closeHour);
    return (
      <div className="countdown">
        <div className="countdown__label">금일 발주 마감은 {deadlineLabel} 입니다.</div>
        <div className="countdown__time">
          <span className="countdown__pre">발주 마감까지</span>
          <span className="countdown__clock">{clock(target - now)}</span>
        </div>
      </div>
    );
  }

  // 마감 상태 → 다음 발주 시작(정오)까지
  let ny = y,
    nmo = mo,
    nda = da;
  if (h >= closeHour) {
    // 저녁: 다음 정오는 내일
    const t = new Date(Date.UTC(y, mo, da) + 24 * 60 * 60 * 1000);
    ny = t.getUTCFullYear();
    nmo = t.getUTCMonth();
    nda = t.getUTCDate();
  }
  const target = targetUtc(ny, nmo, nda, openHour);
  return (
    <div className="countdown countdown--closed">
      <div className="countdown__label">발주가 마감되었습니다</div>
      <div className="countdown__time">
        <span className="countdown__pre">발주 시작까지</span>
        <span className="countdown__clock">{clock(target - now)}</span>
        <span className="countdown__pre">남았습니다</span>
      </div>
    </div>
  );
}
