"use client";

import { useEffect, useState } from "react";

// 저시력(노안) 점주용 글자 확대 — 지금 화면이 '제일 축소' 기준(1.0), 여기서 키우기만.
// document.documentElement.style.zoom 로 전역 적용(모든 페이지·고정 헤더·네비까지 함께 커짐).
// localStorage에 저장 → 새로고침/다른 페이지에서도 유지(복원은 layout의 인라인 스크립트가 선반영).
const LEVELS = [1, 1.15, 1.3, 1.45];
const KEY = "appZoom";

export function ZoomControls() {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(KEY));
      const i = LEVELS.indexOf(saved);
      if (i > 0) setIdx(i);
    } catch {
      /* noop */
    }
  }, []);

  const set = (next: number) => {
    const i = Math.max(0, Math.min(LEVELS.length - 1, next));
    setIdx(i);
    const z = LEVELS[i];
    try {
      document.documentElement.style.zoom = z === 1 ? "" : String(z);
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
