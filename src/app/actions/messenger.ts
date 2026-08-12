"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { kstDateOf } from "@/lib/date";
import {
  setMessengerMemberCookie,
  clearMessengerMemberCookie,
  getMessengerMember,
  hashPin,
  verifyPin,
} from "@/lib/messenger-session";

// yyyy-mm-dd(KST) → 그 날 KST 자정 인스턴트. 할일 마감·일정 날짜를 하루 단위로 안전 저장.
function kstMidnight(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00+09:00`);
  return isNaN(d.getTime()) ? null : d;
}

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
  redirect("/messenger");
}

export async function messengerLogoutAction(): Promise<void> {
  await requireAdmin();
  await clearMessengerMemberCookie();
  redirect("/messenger");
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
  revalidatePath("/messenger");
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
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
  return {};
}
export async function resetMessengerPinAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const pin = String(formData.get("pin") ?? "").trim();
  if (!id || pin.length < 4) return { error: "비밀번호는 4자 이상." };
  await prisma.messengerMember.update({ where: { id }, data: { pinHash: await hashPin(pin) } });
  revalidatePath("/messenger/manage");
  return {};
}
export async function toggleMessengerMemberAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const m = await prisma.messengerMember.findUnique({ where: { id }, select: { active: true } });
  if (!m) return;
  await prisma.messengerMember.update({ where: { id }, data: { active: !m.active } });
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}
export async function addMessengerChannelAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 30);
  if (!name) return { error: "채널 이름을 입력하세요." };
  const max = await prisma.messengerChannel.aggregate({ _max: { sortOrder: true } });
  await prisma.messengerChannel.create({ data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
  return {};
}
export async function archiveMessengerChannelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const ch = await prisma.messengerChannel.findUnique({ where: { id }, select: { archived: true } });
  if (!ch) return;
  await prisma.messengerChannel.update({ where: { id }, data: { archived: !ch.archived } });
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}

// ── 할일(팀 전체 공용) ───────────────────────────────────────
export type TaskDTO = {
  id: string;
  title: string;
  done: boolean;
  assigneeId: string | null;
  toAll: boolean; // 받는 사람 = 팀원 전체
  due: string | null; // yyyy-mm-dd(KST) | null
  createdById: string; // 보낸 사람(시킨 사람)
  createdAt: string;
  doneAt: string | null;
};

export async function loadMessengerTasksAction(): Promise<{ tasks: TaskDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { tasks: [] };
  const rows = await prisma.messengerTask.findMany({ orderBy: [{ done: "asc" }, { createdAt: "desc" }], take: 500 });
  return {
    tasks: rows.map((t) => ({
      id: t.id,
      title: t.title,
      done: t.done,
      assigneeId: t.assigneeId,
      toAll: t.toAll,
      due: t.dueDate ? kstDateOf(t.dueDate) : null,
      createdById: t.createdById,
      createdAt: t.createdAt.toISOString(),
      doneAt: t.doneAt ? t.doneAt.toISOString() : null,
    })),
  };
}

export async function addMessengerTaskAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const title = String(formData.get("title") ?? "").trim().slice(0, 300);
  if (!title) return { error: "할 일을 입력하세요." };
  const toAll = String(formData.get("toAll") ?? "") === "1";
  const assigneeId = toAll ? null : String(formData.get("assigneeId") ?? "").trim() || null;
  if (!toAll && !assigneeId) return { error: "받는 사람을 선택하세요." };
  const due = kstMidnight(String(formData.get("due") ?? "").trim());
  await prisma.messengerTask.create({ data: { title, createdById: me.id, assigneeId, toAll, dueDate: due } });
  revalidatePath("/messenger");
  return {};
}

export async function toggleMessengerTaskAction(id: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  const t = await prisma.messengerTask.findUnique({ where: { id }, select: { done: true } });
  if (!t) return;
  await prisma.messengerTask.update({
    where: { id },
    data: { done: !t.done, doneAt: !t.done ? new Date() : null },
  });
}

export async function updateMessengerTaskAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "" };
  const title = String(formData.get("title") ?? "").trim().slice(0, 300);
  if (!title) return { error: "할 일을 입력하세요." };
  const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
  const dueRaw = String(formData.get("due") ?? "").trim();
  await prisma.messengerTask.update({
    where: { id },
    data: { title, assigneeId, dueDate: dueRaw ? kstMidnight(dueRaw) : null },
  });
  revalidatePath("/messenger");
  return {};
}

export async function deleteMessengerTaskAction(id: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  await prisma.messengerTask.delete({ where: { id } }).catch(() => {});
}

// ── 팀 캘린더(팀 전체 공용) ──────────────────────────────────
export type EventDTO = { id: string; title: string; date: string; memo: string | null; createdById: string };
export type CalTaskDTO = { id: string; title: string; due: string; done: boolean; assigneeId: string | null };

export async function loadMessengerCalendarAction(
  year: number,
  month: number, // 1~12
): Promise<{ events: EventDTO[]; tasks: CalTaskDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { events: [], tasks: [] };
  const mm = String(month).padStart(2, "0");
  const start = kstMidnight(`${year}-${mm}-01`);
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const end = kstMidnight(`${nextY}-${String(nextM).padStart(2, "0")}-01`);
  if (!start || !end) return { events: [], tasks: [] };
  const [events, tasks] = await Promise.all([
    prisma.messengerEvent.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }),
    prisma.messengerTask.findMany({ where: { dueDate: { gte: start, lt: end } }, orderBy: { dueDate: "asc" } }),
  ]);
  return {
    events: events.map((e) => ({ id: e.id, title: e.title, date: kstDateOf(e.date), memo: e.memo, createdById: e.createdById })),
    tasks: tasks.map((t) => ({ id: t.id, title: t.title, due: kstDateOf(t.dueDate!), done: t.done, assigneeId: t.assigneeId })),
  };
}

export async function addMessengerEventAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const date = kstMidnight(String(formData.get("date") ?? "").trim());
  if (!title) return { error: "일정 제목을 입력하세요." };
  if (!date) return { error: "날짜를 확인하세요." };
  const memo = String(formData.get("memo") ?? "").trim().slice(0, 1000) || null;
  await prisma.messengerEvent.create({ data: { title, date, memo, createdById: me.id } });
  revalidatePath("/messenger");
  return {};
}

export async function deleteMessengerEventAction(id: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  await prisma.messengerEvent.delete({ where: { id } }).catch(() => {});
}
