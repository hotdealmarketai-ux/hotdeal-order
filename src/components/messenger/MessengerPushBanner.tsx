"use client";

import { useEffect, useState } from "react";
import { saveMessengerPushSubscriptionAction } from "@/app/actions/messenger";
import { VAPID_PUBLIC_KEY } from "@/lib/vapid";

// 사내 메신저 웹푸시 부트스트랩.
// - 이미 알림 허용된 기기: 브라우저 구독을 '현재 2차 로그인 멤버'에게 자동 귀속(배너 안 뜸).
// - 아직 결정 안 함(default): 작은 '알림 켜기' 배너 → 누르면 권한 요청 + 구독 + 저장.
// - 거부(denied)/미지원: 아무것도 안 함.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// 메신저 전용 SW 스코프 — 발주앱(스코프 "/")과 '다른' 푸시 구독(엔드포인트)을 만든다.
// 전원 공용 saerop로 1차 로그인하므로, 스코프를 분리하지 않으면 브라우저가 만든 단일 구독이
// 루트 레이아웃의 PushSubscriptionSync를 통해 관리자(saerop) User에 귀속돼 지점 발주·입금·고객문의
// 푸시까지 이 기기로 쏟아진다(정보 유출). 스코프 분리로 구독을 완전히 격리한다.
const MSGR_SCOPE = "/messenger";

async function getScopedReg(): Promise<ServiceWorkerRegistration> {
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: MSGR_SCOPE });
  if (reg.active) return reg;
  await new Promise<void>((res) => {
    const w = reg.installing || reg.waiting;
    if (!w) return res();
    const check = () => { if (w.state === "activated") res(); };
    w.addEventListener("statechange", check);
    check();
  });
  return reg;
}

async function subscribeAndSave(): Promise<boolean> {
  const reg = await getScopedReg();
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
  }
  const json = sub.toJSON();
  const r = await saveMessengerPushSubscriptionAction({
    endpoint: sub.endpoint,
    p256dh: json.keys?.p256dh ?? "",
    auth: json.keys?.auth ?? "",
  });
  return !!r?.ok;
}

export function MessengerPushBanner() {
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    )
      return;
    let alive = true;
    (async () => {
      try {
        if (Notification.permission === "denied") return;
        if (Notification.permission === "granted") {
          await subscribeAndSave(); // 이미 허용 → 현재 멤버로 재귀속
          return;
        }
        // default(미결정) → 배너로 유도(단, 닫은 적 있으면 안 띄움)
        if (localStorage.getItem("msgrPushDismiss") !== "1" && alive) setShow(true);
      } catch {
        // 미지원/일시 오류는 조용히 무시
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const enable = async () => {
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setShow(false);
        return;
      }
      await subscribeAndSave();
      setShow(false);
    } catch {
      setShow(false);
    } finally {
      setBusy(false);
    }
  };
  const dismiss = () => {
    try {
      localStorage.setItem("msgrPushDismiss", "1");
    } catch {}
    setShow(false);
  };

  if (!show) return null;
  return (
    <div className="mw__pushbar">
      <svg className="mw__pushbar__ico" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      <span className="mw__pushbar__txt">알림을 켜면 새 메시지·할 일·멘션을 바로 받아요.</span>
      <button type="button" className="mw__pushbar__btn" onClick={enable} disabled={busy}>
        {busy ? "…" : "알림 켜기"}
      </button>
      <button type="button" className="mw__pushbar__x" onClick={dismiss} aria-label="닫기">
        ✕
      </button>
    </div>
  );
}
