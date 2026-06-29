// 웹푸시 발송(서버 전용). 비공개키 없으면 조용히 무시(앱 동작에 영향 없음).
import { prisma } from "@/lib/prisma";
import { VAPID_PUBLIC_KEY } from "@/lib/vapid";
import type { Role } from "@/lib/constants";

const VAPID_SUBJECT = "mailto:hotdealmarketai@gmail.com";

export type PushPayload = { title: string; body: string; url?: string };

// web-push는 서버에서만 동적 import (클라이언트 번들 제외)
async function getWebPush() {
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("web-push");
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, priv);
  return webpush;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const webpush = await getWebPush();
  if (!webpush) return;
  const subs = await prisma.pushSubscription.findMany({ where: { userId } });
  if (subs.length === 0) return;
  const data = JSON.stringify(payload);
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        // 만료/해지된 구독(404/410)은 정리
        if (code === 404 || code === 410) {
          await prisma.pushSubscription
            .delete({ where: { endpoint: s.endpoint } })
            .catch(() => {});
        } else {
          console.error("[push] send failed:", code);
        }
      }
    }),
  );
}

// 특정 업자 역할(서부일광/장흥/채움채/새롭)에게 새 발주 알림.
// fromStoreName = 발주를 넣은 점주(가맹점/소매) 상호.
export async function notifyVendorNewOrder(role: Role, fromStoreName: string) {
  try {
    const vendor = await prisma.user.findFirst({
      where: { role, status: "APPROVED" },
      select: { id: true },
    });
    if (!vendor) return;
    await sendPushToUser(vendor.id, {
      // 제목 한 줄만 보이도록 body는 비움(브라우저가 붙이는 출처 라벨은 제거 불가)
      title: `${fromStoreName} 님에게 발주요청이 도착했습니다.`,
      body: "",
      url: "/vendor",
    });
  } catch (err) {
    console.error("[push] notifyVendorNewOrder failed:", err);
  }
}
