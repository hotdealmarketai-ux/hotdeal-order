"use client";

import { useEffect, useState } from "react";

// 저시력(노안) 점주용 글자 확대 — 지금 화면이 '제일 축소' 기준(1.0), 여기서 키우기만.
// CSS 변수 --zoom 으로 '본문(.page)만' 확대 → 고정 상단 헤더/하단 네비는 그대로(안 움직임).
// (예전엔 document 전체 zoom이라 iOS에서 고정 헤더가 세로로 깨졌음.)
// localStorage에 저장 → 새로고침/다른 페이지에서도 유지(복원은 layout의 인라인 스크립트가 선반영).
const LEVELS = [1, 1.15, 1.3, 1.45];
const KEY = "appZoom";

function applyZoom(z: number) {
  document.documentElement.style.setProperty("--zoom", String(z));
}

export function ZoomControls() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      const i = LEVELS.indexOf(saved);
      if (i > 0) {
        setIdx(i);
        applyZoom(LEVELS[i]);
      }
    } catch {
      /* noop */
    }
  }, []);

  const set = (next: number) => {
    const i = Math.max(0, Math.min(LEVELS.length - 1, next));
    setIdx(i);
    const z = LEVELS[i];
    try {
      applyZoom(z);
      localStorage.setItem(KEY, String(z));
    } catch {
      /* noop */
    }
  };

  return (
    <div className="zoomctl" role="group" aria-label="글자 크기 조절">
      <button
        type="button"
        className="zoomctl__btn"
        onClick={() => set(idx - 1)}
        disabled={idx === 0}
        aria-label="글자 작게"
      >
        가–
      </button>
      <button
        type="button"
        className="zoomctl__btn"
        onClick={() => set(idx + 1)}
        disabled={idx === LEVELS.length - 1}
        aria-label="글자 크게"
      >
        가+
      </button>
    </div>
  );
}
