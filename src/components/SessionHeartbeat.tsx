"use client";

// 로그인한 기기의 하트비트 — 40초마다(그리고 앱이 앞으로 올 때) /api/session/ping 을 쳐서
// 실시간 접속으로 표시되게 하고, 관리자가 이 기기를 강제 로그아웃하면 즉시 로그인 화면으로 보낸다.
// 품목 제한 모드: 핑 응답의 mode(이 지점 모드 표식 'R:키'/'F:키')가 직전 값과 달라지면 router.refresh() —
// 이미 열린 앱(PWA)의 하단 탭(재고현황)과 발주 화면을 새로고침 없이 맞춘다. 첫 응답은 기준값만 저장.
// (공산품 탭은 제한 모드와 상관없이 보여 모드가 바뀌어도 그대로)
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

export function SessionHeartbeat() {
  const router = useRouter();
  const lastMode = useRef<string | null>(null);
  useEffect(() => {
    let stopped = false;
    async function ping() {
      try {
        const res = await fetch("/api/session/ping", { method: "POST", cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean; mode?: string };
        if (!stopped && data && data.ok === false) {
          window.location.href = "/login"; // 강제 로그아웃됨
          return;
        }
        if (!stopped && data && typeof data.mode === "string" && data.mode) {
          const prev = lastMode.current;
          lastMode.current = data.mode;
          if (prev !== null && prev !== data.mode) router.refresh();
        }
      } catch {
        /* 네트워크 일시 오류는 무시(다음 틱 재시도) */
      }
    }
    ping();
    const iv = setInterval(ping, 40000);
    const onVis = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(iv);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [router]);
  return null;
}
