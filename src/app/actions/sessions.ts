"use server";

import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { writeAudit } from "@/lib/audit";

// 특정 기기(로그인) 1개만 강제 로그아웃 — revokedAt 세팅. 해당 기기는 다음 요청/하트비트에서 로그인 화면으로.
export async function revokeSessionAction(sessionId: string): Promise<{ ok: boolean }> {
  const admin = await requireAdmin();
  const id = String(sessionId ?? "");
  if (!id) return { ok: false };
  const s = await prisma.userSession.findUnique({
    where: { id },
    select: {
      revokedAt: true,
      userId: true,
      userAgent: true,
      user: { select: { storeName: true, username: true } },
    },
  });
  if (!s || s.revokedAt) return { ok: false };
  await prisma.userSession.update({ where: { id }, data: { revokedAt: new Date() } });
  await writeAudit({
    action: "session.revoke",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "user",
    targetId: s.userId,
    summary: `강제 로그아웃(기기 1대): ${s.user.storeName}(${s.user.username})`,
  });
  revalidatePath("/admin/sessions");
  return { ok: true };
}

// 한 지점의 모든 기기 강제 로그아웃.
export async function revokeAllUserSessionsAction(userId: string): Promise<{ ok: boolean; count: number }> {
  const admin = await requireAdmin();
  const uid = String(userId ?? "");
  if (!uid) return { ok: false, count: 0 };
  const u = await prisma.user.findUnique({
    where: { id: uid },
    select: { storeName: true, username: true },
  });
  const res = await prisma.userSession.updateMany({
    where: { userId: uid, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count > 0 && u) {
    await writeAudit({
      action: "session.revokeAll",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "user",
      targetId: uid,
      summary: `전체 강제 로그아웃(${res.count}대): ${u.storeName}(${u.username})`,
    });
  }
  revalidatePath("/admin/sessions");
  return { ok: true, count: res.count };
}
