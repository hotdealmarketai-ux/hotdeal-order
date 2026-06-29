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

  return (
    <div className="pushrow">
      <div className="pushrow__main">
        <div className="pushrow__title">발주 알림</div>
        <div className="pushrow__sub">
          {state === "on"
            ? "새 발주가 들어오면 이 기기로 알려드려요."
            : state === "denied"
              ? "브라우저 알림이 차단돼 있어요. 설정에서 허용해 주세요."
              : "알림을 켜면 새 발주를 바로 받아볼 수 있어요."}
        </div>
      </div>
      {state === "on" ? (
        <button type="button" className="btn btn--xs btn--soft" onClick={disable}>
          끄기
        </button>
      ) : state === "denied" ? null : (
        <button
          type="button"
          className="btn btn--xs btn--primary"
          onClick={enable}
          disabled={state === "busy"}
        >
          {state === "busy" ? "설정 중…" : "알림 켜기"}
        </button>
      )}
    </div>
  );
}
