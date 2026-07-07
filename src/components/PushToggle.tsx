// ============================================================
//  PushToggle — 코발트 교체본
//  위치: src/components/PushToggle.tsx 교체
//  변경: 큰 "알림 켜기" 버튼 카드 → 작은 카드 + 토글 스위치
//  로직(SW 등록·구독·저장/해제·denied/unsupported 분기)은 기존과 동일
//  ※ 이 컴포넌트는 업자 화면 등에서도 재사용되므로, 그 화면들도
//    자동으로 같은 토글 스타일이 됩니다(의도된 통일).
// ============================================================

"use client";

import { useEffect, useState } from "react";
import {
  savePushSubscriptionAction,
  removePushSubscriptionAction,
} from "@/app/actions/push";
import { VAPID_PUBLIC_KEY } from "@/lib/vapid";

type State = "checking" | "unsupported" | "denied" | "off" | "on" | "busy";

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

export function PushToggle({
  variant = "card",
}: {
  /** "card" = 본문 카드 + 스위치, "header" = 헤더 우측 벨 아이콘 토글 */
  variant?: "card" | "header";
} = {}) {
  const [state, setState] = useState<State>("checking");
  // 토글을 끈 직후 다시 켤 때 이전 상태 기억용
  const [wasOn, setWasOn] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (
        typeof window === "undefined" ||
        !("serviceWorker" in navigator) ||
        !("PushManager" in window) ||
        !("Notification" in window)
      ) {
        if (alive) setState("unsupported");
        return;
      }
      if (Notification.permission === "denied") {
        if (alive) setState("denied");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.register("/sw.js");
        const sub = await reg.pushManager.getSubscription();
        if (alive) setState(sub ? "on" : "off");
      } catch {
        if (alive) setState("off");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function enable() {
    setWasOn(false);
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const perm = await Notification.requestPermission();
      if (perm !== "granted") {
        setState(perm === "denied" ? "denied" : "off");
        return;
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await savePushSubscriptionAction({
        endpoint: sub.endpoint,
        p256dh: json.keys?.p256dh ?? "",
        auth: json.keys?.auth ?? "",
      });
      setState("on");
    } catch (err) {
      console.error("[push] enable failed", err);
      setState("off");
    }
  }

  async function disable() {
    setWasOn(true);
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await removePushSubscriptionAction(sub.endpoint);
        await sub.unsubscribe();
      }
      setState("off");
    } catch {
      setState("off");
    }
  }

  if (state === "checking" || state === "unsupported") return null;

  const on = state === "on";
  const busy = state === "busy";

  // 헤더 우측 벨 아이콘 토글(상호명 옆)
  if (variant === "header") {
    return (
      <button
        type="button"
        className={`tbar__push ${on ? "is-on" : "is-off"}`}
        aria-label={on ? "앱 알림 켜짐, 눌러서 끄기" : "앱 알림 꺼짐, 눌러서 켜기"}
        aria-pressed={on}
        title={
          state === "denied"
            ? "브라우저에서 알림이 차단됨 — 설정에서 허용해 주세요"
            : on
              ? "앱 알림 켜짐"
              : "앱 알림 받기"
        }
        onClick={on ? disable : enable}
        disabled={busy}
      >
        {on ? (
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
            <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
          </svg>
        ) : (
          <svg
            width="19"
            height="19"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            <path d="M18.63 13A17.89 17.89 0 0 1 18 8" />
            <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
            <path d="M18 8a6 6 0 0 0-9.33-5" />
            <line x1="2" y1="2" x2="22" y2="22" />
          </svg>
        )}
      </button>
    );
  }

  return (
    <div className="pushcard">
      <div className="pushcard__main">
        <div className="pushcard__title">앱 알림</div>
        <div className="pushcard__sub">
          {on ? "새 발주 소식을 이 기기로 알려드려요." : "앱에서 알림을 허용합니다."}
        </div>
      </div>
      {state !== "denied" && (
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label="앱 알림"
          className={`switch ${on || (busy && !wasOn) ? "is-on" : ""}`}
          onClick={on ? disable : enable}
          disabled={busy}
        >
          <span className="switch__knob" />
        </button>
      )}
    </div>
  );
}
