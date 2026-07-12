"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

// 내 알림 전부 읽음 처리(알림목록 진입 시 호출 → 미읽음 배지 소멸). #8/#10
export async function markAllNotificationsReadAction() {
  const user = await requireUser();
  await prisma.notification.updateMany({
    where: { userId: user.id, readAt: null },
    data: { readAt: new Date() },
  });
  revalidatePath("/notifications");
}

// 알림 1건 삭제 — 내 화면에서만(알림은 유저당 1행이라 소유자 전용). #10 스와이프 삭제
export async function deleteNotificationAction(id: string) {
  const user = await requireUser();
  if (!id) return;
  await prisma.notification.deleteMany({ where: { id, userId: user.id } });
  revalidatePath("/notifications");
}

// 내 알림 전체 삭제(초기화)
export async function clearAllNotificationsAction() {
  const user = await requireUser();
  await prisma.notification.deleteMany({ where: { userId: user.id } });
  revalidatePath("/notifications");
}
