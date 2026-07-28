"use client";

import { useState, type ReactNode } from "react";

// 접기/펼치기 섹션 — 기본 닫힘. 관리자 페이지에서 잘 안 쓰는 기능들을 숨겨 스크롤을 줄인다.
export function Collapsible({
  title,
  hint,
  children,
  defaultOpen = false,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`collapsible${open ? " is-open" : ""}`}>
      <button
        type="button"
        className="collapsible__head"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="collapsible__title">
          {title}
          {hint && <span className="collapsible__hint">{hint}</span>}
        </span>
        <span className="collapsible__caret" aria-hidden="true">
          {open ? "▲" : "▼"}
        </span>
      </button>
      {open && <div className="collapsible__body">{children}</div>}
    </div>
  );
}
