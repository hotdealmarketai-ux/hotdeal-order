"use server";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

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
