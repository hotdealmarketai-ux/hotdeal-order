"use client";

import { useEffect } from "react";
import { syncPushSubscriptionAction } from "@/app/actions/push";

// S1 같은 브라우저에서 여러 계정(관리자·가맹점주)을 오갈 때, 브라우저의 푸시 구독이 '이전 로그인 유저'에
// 묶여 남는 문제를 막는다. 페이지 로드마다 현재 로그인 유저에게 구독을 재귀속(endpoint 유니크 → 소유자 갱신).
// → 지금 로그인한 유저의 알림만 이 기기로 온다.
export function PushSubscriptionSync() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    (async () => {
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = await reg?.pushManager.getSubscription();
        if (!sub) return;
        const json = sub.toJSON();
        await syncPushSubscriptionAction({
          endpoint: sub.endpoint,
          p256dh: json.keys?.p256dh ?? "",
          auth: json.keys?.auth ?? "",
        });
      } catch {
        // 비로그인/미지원 등은 조용히 무시
      }
    })();
  }, []);
  return null;
}
