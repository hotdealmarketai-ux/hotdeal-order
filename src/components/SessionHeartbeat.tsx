"use client";

// 로그인한 기기의 하트비트 — 40초마다(그리고 앱이 앞으로 올 때) /api/session/ping 을 쳐서
// 실시간 접속으로 표시되게 하고, 관리자가 이 기기를 강제 로그아웃하면 즉시 로그인 화면으로 보낸다.
import { useEffect } from "react";

export function SessionHeartbeat() {
  useEffect(() => {
    let stopped = false;
    async function ping() {
      try {
        const res = await fetch("/api/session/ping", { method: "POST", cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { ok?: boolean };
        if (!stopped && data && data.ok === false) {
          window.location.href = "/login"; // 강제 로그아웃됨
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
  }, []);
  return null;
}
