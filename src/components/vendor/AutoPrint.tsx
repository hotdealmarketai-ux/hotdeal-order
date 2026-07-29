"use client";

import { useEffect } from "react";

// 페이지가 뜨면 바로 인쇄 대화상자 호출 → Chrome 키오스크 인쇄(--kiosk-printing) 설정 시 확인 없이 바로 출력.
export function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        window.print();
      } catch {
        /* noop */
      }
    }, 350);
    return () => clearTimeout(t);
  }, []);
  return null;
}
