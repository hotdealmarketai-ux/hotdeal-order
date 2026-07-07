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

export function PushToggle() {
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
