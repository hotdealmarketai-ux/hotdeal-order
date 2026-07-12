"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";

// 확인 모달 오버레이 — 항상 document.body 로 포탈한다.
// .sheet 를 .row/.tbar 같은 조상 안에 두면, 그 조상의 transform(예: `.row:active{transform:scale}`)
// 이나 sticky+z-index 가 position:fixed 를 그 박스에 '가둬' 버린다. 그러면 모달이 화면 전체를 덮지
// 못하고(하단 네비 뒤로 숨음) 탭이 버튼을 빗나가(확인창이 안 닫히는 것처럼 보임) 버그가 난다.
// body 로 포탈하면 조상 스택 컨텍스트를 벗어나 z-index:100 이 하단 네비(z-index:40)를 항상 이긴다.
export function Sheet({
  onClose,
  children,
}: {
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="sheet"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
