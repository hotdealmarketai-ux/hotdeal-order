"use server";

import { prisma } from "@/lib/prisma";
import { requireUser, getCurrentUser } from "@/lib/session";

// S1 페이지 로드마다 브라우저 구독을 '현재 로그인 유저'로 재귀속(소프트 — 비로그인이면 조용히 통과, 리다이렉트 X).
export async function syncPushSubscriptionAction(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  const user = await getCurrentUser();
  if (!user) return { ok: false };
  if (!sub?.endpoint || !sub.p256dh || !sub.auth) return { ok: false };
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId: user.id, p256dh: sub.p256dh, auth: sub.auth },
    create: {
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  });
  return { ok: true };
}

export async function savePushSubscriptionAction(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  const user = await requireUser();
  if (!sub?.endpoint || !sub.p256dh || !sub.auth) return { ok: false };
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { userId: user.id, p256dh: sub.p256dh, auth: sub.auth },
    create: {
      userId: user.id,
      endpoint: sub.endpoint,
      p256dh: sub.p256dh,
      auth: sub.auth,
    },
  });
  return { ok: true };
}

export async function removePushSubscriptionAction(endpoint: string) {
  await requireUser();
  if (endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { endpoint } });
  }
  return { ok: true };
}
