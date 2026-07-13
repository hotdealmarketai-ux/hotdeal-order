"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type Toast = { id: number; title: string; body: string; url: string };

// #10a 앱이 열려 있을(포그라운드) 때도 푸시가 '보이게' — 서비스워커가 push를 받으면
// 열린 클라이언트에 메시지를 보내고, 여기서 인앱 배너를 띄우고 알림배지를 새로고침한다.
// (OS 배너는 sw.js가 항상 별도로 띄운다. iOS 포그라운드처럼 OS 배너가 눌리는 환경 대비 인앱 표시.)
export function PushForegroundListener() {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onMessage = (e: MessageEvent) => {
      const d = e.data;
      if (!d || d.kind !== "push") return;
      seq.current += 1;
      setToast({
        id: seq.current,
        title: String(d.title || "핫딜오더"),
        body: String(d.body || ""),
        url: String(d.url || "/"),
      });
      // 알림배지(벨) 등 서버 데이터 갱신
      router.refresh();
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setToast(null), 6000);
    };

    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => {
      navigator.serviceWorker.removeEventListener("message", onMessage);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  if (!toast) return null;

  return (
    <button
      type="button"
      className="pushtoast"
      onClick={() => {
        const url = toast.url;
        setToast(null);
        if (url) router.push(url);
      }}
    >
      <span className="pushtoast__ico" aria-hidden="true">
        🔔
      </span>
      <span className="pushtoast__txt">
        <span className="pushtoast__title">{toast.title}</span>
        {toast.body && <span className="pushtoast__body">{toast.body}</span>}
      </span>
    </button>
  );
}
