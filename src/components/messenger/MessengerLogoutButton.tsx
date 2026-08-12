"use client";

import { useState } from "react";
import { messengerLogoutAction, removeMessengerPushSubscriptionAction } from "@/app/actions/messenger";

// 로그아웃 시 이 기기의 메신저 푸시 구독을 해제 — 로그아웃한 멤버에게 계속 알림이 가지 않도록.
// (메신저 전용 SW 스코프 /messenger 의 구독만 건드리므로 발주앱 푸시엔 영향 없음.)
export function MessengerLogoutButton({ className }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
        const reg = await navigator.serviceWorker.getRegistration("/messenger");
        const sub = await reg?.pushManager.getSubscription();
        if (sub) {
          await removeMessengerPushSubscriptionAction(sub.endpoint).catch(() => {});
          await sub.unsubscribe().catch(() => {});
        }
      }
    } catch {
      // 구독 해제 실패해도 로그아웃은 진행
    }
    await messengerLogoutAction();
  };
  return (
    <button type="button" className={className} onClick={onClick} disabled={busy}>
      {busy ? "…" : "로그아웃"}
    </button>
  );
}
