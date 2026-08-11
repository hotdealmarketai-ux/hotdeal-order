"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import {
  setMessengerMemberCookie,
  clearMessengerMemberCookie,
  getMessengerMember,
  hashPin,
  verifyPin,
} from "@/lib/messenger-session";

// 모든 액션은 1차(새롭 관리자) 게이트 뒤 — 외부(가맹점)는 애초에 관리자 화면 접근 불가.

// ── 2차 로그인 ──────────────────────────────────────────────
export async function messengerLoginAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const memberId = String(formData.get("memberId") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!memberId || !pin) return { error: "이름과 비밀번호를 확인하세요." };
  const m = await prisma.messengerMember.findUnique({ where: { id: memberId } });
  if (!m || !m.active) return { error: "사용할 수 없는 멤버예요." };
  if (!(await verifyPin(pin, m.pinHash))) return { error: "비밀번호가 맞지 않아요." };
  await setMessengerMemberCookie(m.id);
  redirect("/admin/messenger");
}

export async function messengerLogoutAction(): Promise<void> {
  await requireAdmin();
  await clearMessengerMemberCookie();
  redirect("/admin/messenger");
}

// ── 메시지 ─────────────────────────────────────────────────
export async function sendMessengerMessageAction(
  formData: FormData,
): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const channelId = String(formData.get("channelId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim().slice(0, 4000);
  const mediaUrl = String(formData.get("mediaUrl") ?? "").trim() || null;
  const mediaTypeRaw = String(formData.get("mediaType") ?? "").trim();
  const mediaType = mediaTypeRaw === "image" || mediaTypeRaw === "video" ? mediaTypeRaw : null;
  if (!channelId) return { error: "채널을 선택하세요." };
  if (!body && !mediaUrl) return { error: "" }; // 빈 전송 무시

  const ch = await prisma.messengerChannel.findFirst({ where: { id: channelId, archived: false } });
  if (!ch) return { error: "채널을 찾을 수 없어요." };

  await prisma.messengerMessage.create({
    data: { channelId, memberId: me.id, body, mediaUrl, mediaType },
  });
  // 보낸 사람은 그 채널을 방금 읽은 것으로.
  await prisma.messengerRead.upsert({
    where: { memberId_channelId: { memberId: me.id, channelId } },
    create: { memberId: me.id, channelId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  revalidatePath("/admin/messenger");
  return {};
}

// 채널 열람 시 읽음 처리(안 읽음 배지 소멸용).
export async function markMessengerReadAction(channelId: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !channelId) return;
  await prisma.messengerRead.upsert({
    where: { memberId_channelId: { memberId: me.id, channelId } },
    create: { memberId: me.id, channelId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
}

// 폴링용 — 그 채널 메시지 최신 N개 + 읽음 처리.
export async function loadMessengerChannelAction(channelId: string): Promise<{
  messages: { id: string; memberId: string; memberName: string; body: string; mediaUrl: string | null; mediaType: string | null; at: string }[];
}> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !channelId) return { messages: [] };
  const rows = await prisma.messengerMessage.findMany({
    where: { channelId },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, memberId: true, body: true, mediaUrl: true, mediaType: true, createdAt: true, member: { select: { name: true } } },
  });
  await prisma.messengerRead.upsert({
    where: { memberId_channelId: { memberId: me.id, channelId } },
    create: { memberId: me.id, channelId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  return {
    messages: rows.map((m) => ({
      id: m.id,
      memberId: m.memberId,
      memberName: m.member.name,
      body: m.body,
      mediaUrl: m.mediaUrl,
      mediaType: m.mediaType,
      at: m.createdAt.toISOString(),
    })),
  };
}

// 채널별 안 읽음 수(배지 폴링).
export async function messengerUnreadAction(): Promise<Record<string, number>> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return {};
  const [channels, reads] = await Promise.all([
    prisma.messengerChannel.findMany({ where: { archived: false }, select: { id: true } }),
    prisma.messengerRead.findMany({ where: { memberId: me.id }, select: { channelId: true, lastReadAt: true } }),
  ]);
  const readMap = new Map(reads.map((r) => [r.channelId, r.lastReadAt]));
  const out: Record<string, number> = {};
  for (const ch of channels) {
    const since = readMap.get(ch.id);
    const n = await prisma.messengerMessage.count({
      where: { channelId: ch.id, memberId: { not: me.id }, ...(since ? { createdAt: { gt: since } } : {}) },
    });
    out[ch.id] = n;
  }
  return out;
}

// ── 관리(멤버·채널) — 1차 관리자면 누구나(공용 계정) ──────────────
export async function addMessengerMemberAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 30);
  const pin = String(formData.get("pin") ?? "").trim();
  if (!name) return { error: "이름을 입력하세요." };
  if (pin.length < 4) return { error: "비밀번호는 4자 이상." };
  const max = await prisma.messengerMember.aggregate({ _max: { sortOrder: true } });
  await prisma.messengerMember.create({
    data: { name, pinHash: await hashPin(pin), sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/admin/messenger/manage");
  revalidatePath("/admin/messenger");
  return {};
}
export async function resetMessengerPinAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!id || pin.length < 4) return { error: "비밀번호는 4자 이상." };
  await prisma.messengerMember.update({ where: { id }, data: { pinHash: await hashPin(pin) } });
  revalidatePath("/admin/messenger/manage");
  return {};
}
export async function toggleMessengerMemberAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const m = await prisma.messengerMember.findUnique({ where: { id }, select: { active: true } });
  if (!m) return;
  await prisma.messengerMember.update({ where: { id }, data: { active: !m.active } });
  revalidatePath("/admin/messenger/manage");
  revalidatePath("/admin/messenger");
}
export async function addMessengerChannelAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 30);
  if (!name) return { error: "채널 이름을 입력하세요." };
  const max = await prisma.messengerChannel.aggregate({ _max: { sortOrder: true } });
  await prisma.messengerChannel.create({ data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  revalidatePath("/admin/messenger/manage");
  revalidatePath("/admin/messenger");
  return {};
}
export async function archiveMessengerChannelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const ch = await prisma.messengerChannel.findUnique({ where: { id }, select: { archived: true } });
  if (!ch) return;
  await prisma.messengerChannel.update({ where: { id }, data: { archived: !ch.archived } });
  revalidatePath("/admin/messenger/manage");
  revalidatePath("/admin/messenger");
}
