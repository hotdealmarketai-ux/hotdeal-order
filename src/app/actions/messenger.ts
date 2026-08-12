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
  const mediaUrlRaw = String(formData.get("mediaUrl") ?? "").trim() || null;
  const mediaTypeRaw = String(formData.get("mediaType") ?? "").trim();
  const mediaTypeIn = mediaTypeRaw === "image" || mediaTypeRaw === "video" ? mediaTypeRaw : null;
  // 사진 묶어보내기 — 여러 장(2장 이상이면 그리드). 최대 10장.
  const mediaUrls = formData.getAll("mediaUrls").map((v) => String(v).trim()).filter(Boolean).slice(0, 10);
  // 대표 URL/타입(하위호환·미리보기): 단일 첨부면 그대로, 묶음이면 첫 장.
  const mediaUrl = mediaUrlRaw ?? (mediaUrls[0] ?? null);
  const mediaType = mediaTypeIn ?? (mediaUrls.length ? "image" : null);
  if (!channelId) return { error: "채널을 선택하세요." };
  if (!body && !mediaUrl && mediaUrls.length === 0) return { error: "" }; // 빈 전송 무시

  const ch = await prisma.messengerChannel.findFirst({ where: { id: channelId, archived: false } });
  if (!ch) return { error: "채널을 찾을 수 없어요." };

  // 답장(대댓글) — 원본 미리보기 비정규화 저장.
  const replyToId = String(formData.get("replyToId") ?? "").trim() || null;
  const replyToName = String(formData.get("replyToName") ?? "").trim().slice(0, 30) || null;
  const replyToBody = String(formData.get("replyToBody") ?? "").trim().slice(0, 120) || null;

  const msg = await prisma.messengerMessage.create({
    data: { channelId, memberId: me.id, body, mediaUrl, mediaType, mediaUrls, replyToId, replyToName, replyToBody },
  });

  // @멘션 파싱 — 본문에 "@이름"이 있으면 그 멤버를 언급으로 기록(본인 제외). 홈 멘션 토픽용.
  if (body.includes("@")) {
    const members = await prisma.messengerMember.findMany({ where: { active: true }, select: { id: true, name: true } });
    const preview = (body || "사진").slice(0, 140);
    const mentions = members
      .filter((m) => m.id !== me.id && body.includes(`@${m.name}`))
      .map((m) => ({ channelId, messageId: msg.id, mentionedMemberId: m.id, byMemberId: me.id, preview }));
    if (mentions.length) await prisma.messengerMention.createMany({ data: mentions });
  }

  // 보낸 사람은 그 채널을 방금 읽은 것으로.
  await prisma.messengerRead.upsert({
    where: { memberId_channelId: { memberId: me.id, channelId } },
    create: { memberId: me.id, channelId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });
  revalidatePath("/messenger");
  return {};
}

// 메시지 전송 취소(삭제) — 본인이 보낸 메시지만.
export async function deleteMessengerMessageAction(messageId: string): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !messageId) return { error: "" };
  const msg = await prisma.messengerMessage.findUnique({ where: { id: messageId }, select: { memberId: true } });
  if (!msg) return {};
  if (msg.memberId !== me.id) return { error: "내가 보낸 메시지만 취소할 수 있어요." };
  await prisma.messengerMention.deleteMany({ where: { messageId } }).catch(() => {});
  await prisma.messengerMessage.delete({ where: { id: messageId } }).catch(() => {});
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

export type ChatMsgDTO = {
  id: string;
  memberId: string;
  memberName: string;
  body: string;
  mediaUrl: string | null;
  mediaType: string | null;
  mediaUrls: string[]; // 사진 묶음(2장 이상이면 그리드), 없으면 []
  replyToName: string | null;
  replyToBody: string | null;
  notice: boolean;
  at: string;
};

// 폴링용 — 그 채널 메시지 최신 N개 + 읽음 처리.
export async function loadMessengerChannelAction(channelId: string): Promise<{ messages: ChatMsgDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !channelId) return { messages: [] };
  // 최신 300개를 불러온 뒤 오름차순으로 뒤집는다(오래된 300개만 보여서 새 메시지가 안 뜨던 문제 방지).
  const rows = (
    await prisma.messengerMessage.findMany({
      where: { channelId },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: {
        id: true, memberId: true, body: true, mediaUrl: true, mediaType: true, mediaUrls: true, createdAt: true,
        replyToName: true, replyToBody: true, noticeAt: true,
        member: { select: { name: true } },
      },
    })
  ).reverse();
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
      mediaUrls: m.mediaUrls ?? [],
      replyToName: m.replyToName,
      replyToBody: m.replyToBody,
      notice: !!m.noticeAt,
      at: m.createdAt.toISOString(),
    })),
  };
}

// 공지 등록/해제 — 공지는 채널당 1개(등록 시 기존 공지 자동 해제).
export async function toggleMessengerNoticeAction(messageId: string, on: boolean): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !messageId) return;
  const msg = await prisma.messengerMessage.findUnique({ where: { id: messageId }, select: { channelId: true } });
  if (!msg) return;
  if (on) {
    await prisma.messengerMessage.updateMany({ where: { channelId: msg.channelId, noticeAt: { not: null } }, data: { noticeAt: null } });
    await prisma.messengerMessage.update({ where: { id: messageId }, data: { noticeAt: new Date() } }).catch(() => {});
  } else {
    await prisma.messengerMessage.update({ where: { id: messageId }, data: { noticeAt: null } }).catch(() => {});
  }
}

// 채널 공지 목록(상단 고정 바용).
export async function loadMessengerNoticesAction(channelId: string): Promise<{
  notices: { id: string; body: string; name: string; at: string }[];
}> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !channelId) return { notices: [] };
  const rows = await prisma.messengerMessage.findMany({
    where: { channelId, noticeAt: { not: null } },
    orderBy: { noticeAt: "desc" },
    take: 20,
    select: { id: true, body: true, noticeAt: true, member: { select: { name: true } } },
  });
  return { notices: rows.map((r) => ({ id: r.id, body: r.body || "(사진)", name: r.member.name, at: r.noticeAt!.toISOString() })) };
}

// 홈 멘션 토픽 — 나를 @언급한 메시지들(누르면 해당 채팅으로 이동).
export async function loadMessengerMentionsAction(): Promise<{
  mentions: { id: string; channelId: string; channelName: string; messageId: string; by: string; preview: string; at: string }[];
}> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { mentions: [] };
  const rows = await prisma.messengerMention.findMany({
    where: { mentionedMemberId: me.id, readAt: null }, // 확인(클릭)한 멘션은 제외
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  if (rows.length === 0) return { mentions: [] };
  const chIds = [...new Set(rows.map((r) => r.channelId))];
  const byIds = [...new Set(rows.map((r) => r.byMemberId))];
  const [chans, bys] = await Promise.all([
    prisma.messengerChannel.findMany({ where: { id: { in: chIds } }, select: { id: true, name: true, archived: true } }),
    prisma.messengerMember.findMany({ where: { id: { in: byIds } }, select: { id: true, name: true } }),
  ]);
  const chMap = new Map(chans.map((c) => [c.id, c]));
  const byMap = new Map(bys.map((b) => [b.id, b.name]));
  return {
    mentions: rows
      .filter((r) => !chMap.get(r.channelId)?.archived)
      .map((r) => ({
        id: r.id,
        channelId: r.channelId,
        channelName: chMap.get(r.channelId)?.name ?? "채널",
        messageId: r.messageId,
        by: byMap.get(r.byMemberId) ?? "누군가",
        preview: r.preview,
        at: r.createdAt.toISOString(),
      })),
  };
}

// 홈에서 멘션 토픽을 눌러 확인 → 읽음 처리(그 멤버의 해당 멘션만). '받은 멘션'에서 사라짐.
export async function markMentionReadAction(mentionId: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !mentionId) return;
  await prisma.messengerMention
    .updateMany({ where: { id: mentionId, mentionedMemberId: me.id, readAt: null }, data: { readAt: new Date() } })
    .catch(() => {});
}

// 채널 보관함 — 이 채널에 올라온 모든 사진·영상(카카오톡식 갤러리).
export type MediaItemDTO = { messageId: string; url: string; type: "image" | "video"; at: string; name: string };
export async function loadMessengerChannelMediaAction(channelId: string): Promise<{ items: MediaItemDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !channelId) return { items: [] };
  const rows = await prisma.messengerMessage.findMany({
    where: { channelId, OR: [{ mediaUrl: { not: null } }, { mediaUrls: { isEmpty: false } }] },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: { id: true, mediaUrl: true, mediaType: true, mediaUrls: true, createdAt: true, member: { select: { name: true } } },
  });
  const items: MediaItemDTO[] = [];
  for (const m of rows) {
    const at = m.createdAt.toISOString();
    const type: "image" | "video" = m.mediaType === "video" ? "video" : "image";
    const urls = m.mediaUrls && m.mediaUrls.length ? m.mediaUrls : m.mediaUrl ? [m.mediaUrl] : [];
    for (const url of urls) items.push({ messageId: m.id, url, type, at, name: m.member.name });
  }
  return { items };
}

// 채널 안 대화 검색.
export type SearchHitDTO = { messageId: string; body: string; name: string; at: string };
export async function searchMessengerChannelAction(channelId: string, q: string): Promise<{ hits: SearchHitDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  const query = q.trim();
  if (!me || !channelId || query.length < 1) return { hits: [] };
  const rows = await prisma.messengerMessage.findMany({
    where: { channelId, body: { contains: query, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, body: true, createdAt: true, member: { select: { name: true } } },
  });
  return { hits: rows.map((m) => ({ messageId: m.id, body: m.body, name: m.member.name, at: m.createdAt.toISOString() })) };
}

// 전 채널 대화 검색(홈 검색바) — 어느 채널의 어떤 대화인지.
export type GlobalHitDTO = { channelId: string; channelName: string; messageId: string; body: string; name: string; at: string };
export async function searchMessengerAllAction(q: string): Promise<{ hits: GlobalHitDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  const query = q.trim();
  if (!me || query.length < 1) return { hits: [] };
  const chans = await prisma.messengerChannel.findMany({ where: { archived: false }, select: { id: true, name: true } });
  const nameMap = new Map(chans.map((c) => [c.id, c.name]));
  const rows = await prisma.messengerMessage.findMany({
    where: { channelId: { in: chans.map((c) => c.id) }, body: { contains: query, mode: "insensitive" } },
    orderBy: { createdAt: "desc" },
    take: 60,
    select: { id: true, channelId: true, body: true, createdAt: true, member: { select: { name: true } } },
  });
  return {
    hits: rows.map((m) => ({
      channelId: m.channelId,
      channelName: nameMap.get(m.channelId) ?? "채널",
      messageId: m.id,
      body: m.body,
      name: m.member.name,
      at: m.createdAt.toISOString(),
    })),
  };
}

// 홈 '이번 주 일정' — 이번 주(월~일) 캘린더 일정 + 이번 주 마감 할일(팀 전체 공용).
export type WeekItemDTO = { id: string; kind: "event" | "task"; title: string; memo: string | null; who: string | null; date: string };
export async function loadMessengerWeekAgendaAction(): Promise<{ items: WeekItemDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
  // 이번 주 = 월~일. 요일은 달력상 날짜(UTC) 기준으로 계산해 서버 TZ 영향 배제.
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0=일 … 6=토
  const fromMon = (dow + 6) % 7; // 월=0 … 일=6
  const wsD = new Date(`${today}T00:00:00Z`);
  wsD.setUTCDate(wsD.getUTCDate() - fromMon);
  const weD = new Date(wsD);
  weD.setUTCDate(weD.getUTCDate() + 7);
  const start = kstMidnight(wsD.toISOString().slice(0, 10));
  const end = kstMidnight(weD.toISOString().slice(0, 10));
  if (!me || !start || !end) return { items: [] };
  const [events, tasks] = await Promise.all([
    prisma.messengerEvent.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }),
    prisma.messengerTask.findMany({ where: { dueDate: { gte: start, lt: end }, done: false }, orderBy: { dueDate: "asc" } }),
  ]);
  const idsOf = (t: { assigneeIds: string[]; assigneeId: string | null }) =>
    t.assigneeIds.length ? t.assigneeIds : t.assigneeId ? [t.assigneeId] : [];
  const ids = [...new Set(tasks.flatMap(idsOf))];
  const mem = ids.length ? await prisma.messengerMember.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const nameMap = new Map(mem.map((m) => [m.id, m.name]));
  const items: WeekItemDTO[] = [
    ...events.map((e) => ({ id: e.id, kind: "event" as const, title: e.title, memo: e.memo, who: null, date: kstDateOf(e.date) })),
    ...tasks.map((t) => {
      const list = idsOf(t);
      return {
        id: t.id,
        kind: "task" as const,
        title: t.title,
        memo: null,
        who: t.toAll ? "팀원 전체" : list.length ? list.map((id) => nameMap.get(id) ?? "지난 멤버").join(", ") : "미지정",
        date: kstDateOf(t.dueDate!),
      };
    }),
  ];
  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { items };
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
export async function renameMessengerMemberAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 30);
  if (!id) return { error: "" };
  if (!name) return { error: "이름을 입력하세요." };
  await prisma.messengerMember.update({ where: { id }, data: { name } }).catch(() => {});
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
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
// 멤버 삭제(하드) — 메시지·읽음은 FK Cascade 로 함께 삭제. 할일/멘션의 memberId(문자열)는 '지난 멤버'로 표시.
export async function deleteMessengerMemberAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  // 이 멤버 관련 멘션(문자열 참조, FK 없음)도 정리 — 죽은 '받은 멘션' 방지.
  await prisma.messengerMention.deleteMany({ where: { OR: [{ mentionedMemberId: id }, { byMemberId: id }] } }).catch(() => {});
  await prisma.messengerMember.delete({ where: { id } }).catch(() => {});
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
// 채널 이름 수정.
export async function renameMessengerChannelAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!id) return { error: "" };
  if (!name) return { error: "채널 이름을 입력하세요." };
  await prisma.messengerChannel.update({ where: { id }, data: { name } }).catch(() => {});
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
  return {};
}
// 채널 삭제(하드) — 메시지·읽음은 FK Cascade, 멘션(문자열 channelId)은 별도 정리. 되돌릴 수 없음.
export async function deleteMessengerChannelAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await prisma.messengerMention.deleteMany({ where: { channelId: id } }).catch(() => {});
  await prisma.messengerChannel.delete({ where: { id } }).catch(() => {});
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}
// 채널 순서 변경(관리) — 전체를 현재 표시순 인덱스로 정규화 후 인접 스왑(기존 sortOrder 중복/구멍에도 안전).
export async function reorderMessengerChannelAction(id: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  const chans = await prisma.messengerChannel.findMany({
    orderBy: [{ archived: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const order = chans.map((c) => c.id);
  const idx = order.indexOf(id);
  if (idx < 0) return;
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= order.length) return;
  [order[idx], order[swap]] = [order[swap], order[idx]];
  await prisma.$transaction(order.map((cid, i) => prisma.messengerChannel.update({ where: { id: cid }, data: { sortOrder: i } })));
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}
// 채널 즐겨찾기 토글(팀 공용).
export async function toggleMessengerFavoriteAction(channelId: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !channelId) return;
  const c = await prisma.messengerChannel.findUnique({ where: { id: channelId }, select: { favorite: true } });
  if (!c) return;
  await prisma.messengerChannel.update({ where: { id: channelId }, data: { favorite: !c.favorite } });
  revalidatePath("/messenger");
}

// ── 채널 그룹(단 나누기) ─────────────────────────────────────
export async function addMessengerChannelGroupAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!name) return { error: "그룹 이름을 입력하세요." };
  const max = await prisma.messengerChannelGroup.aggregate({ _max: { sortOrder: true } });
  await prisma.messengerChannelGroup.create({ data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
  return {};
}
export async function renameMessengerChannelGroupAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!id) return { error: "" };
  if (!name) return { error: "그룹 이름을 입력하세요." };
  await prisma.messengerChannelGroup.update({ where: { id }, data: { name } }).catch(() => {});
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
  return {};
}
// 그룹 삭제 — 소속 채널은 지우지 않고 '그룹 없음'으로.
export async function deleteMessengerChannelGroupAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  await prisma.messengerChannel.updateMany({ where: { groupId: id }, data: { groupId: null } });
  await prisma.messengerChannelGroup.delete({ where: { id } }).catch(() => {});
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}
export async function reorderMessengerChannelGroupAction(id: string, dir: "up" | "down"): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  const groups = await prisma.messengerChannelGroup.findMany({ orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], select: { id: true } });
  const order = groups.map((g) => g.id);
  const idx = order.indexOf(id);
  if (idx < 0) return;
  const swap = dir === "up" ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= order.length) return;
  [order[idx], order[swap]] = [order[swap], order[idx]];
  await prisma.$transaction(order.map((gid, i) => prisma.messengerChannelGroup.update({ where: { id: gid }, data: { sortOrder: i } })));
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}
// 채널을 그룹에 배정(빈 값=그룹 없음).
export async function setMessengerChannelGroupAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  const channelId = String(formData.get("channelId") ?? "").trim();
  const groupId = String(formData.get("groupId") ?? "").trim() || null;
  if (!me || !channelId) return;
  await prisma.messengerChannel.update({ where: { id: channelId }, data: { groupId } }).catch(() => {});
  revalidatePath("/messenger/manage");
  revalidatePath("/messenger");
}

// ── 할일(팀 전체 공용) ───────────────────────────────────────
export type TaskDTO = {
  id: string;
  title: string;
  detail: string | null; // 상세 설명(제목 클릭 시 팝업)
  done: boolean;
  assigneeId: string | null; // (레거시) 단일
  assigneeIds: string[]; // 받는 사람(다중)
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
      detail: t.detail,
      done: t.done,
      assigneeId: t.assigneeId,
      assigneeIds: t.assigneeIds.length ? t.assigneeIds : t.assigneeId ? [t.assigneeId] : [],
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
  const detail = String(formData.get("detail") ?? "").trim().slice(0, 2000) || null;
  const toAll = String(formData.get("toAll") ?? "") === "1";
  const assigneeIds = toAll ? [] : [...new Set(formData.getAll("assigneeIds").map((v) => String(v).trim()).filter(Boolean))];
  if (!toAll && assigneeIds.length === 0) return { error: "받는 사람을 선택하세요." };
  const due = kstMidnight(String(formData.get("due") ?? "").trim());
  await prisma.messengerTask.create({
    data: { title, detail, createdById: me.id, assigneeId: assigneeIds[0] ?? null, assigneeIds, toAll, dueDate: due },
  });

  // 채널에서 추가한 경우(홈이 아니면) 그 채널에 '할 일이 등록되었습니다' 안내 메시지.
  const channelId = String(formData.get("channelId") ?? "").trim();
  if (channelId) {
    const ch = await prisma.messengerChannel.findFirst({ where: { id: channelId, archived: false }, select: { id: true } });
    if (ch) {
      let whoLabel = "팀원 전체";
      if (!toAll) {
        const mem = await prisma.messengerMember.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true } });
        const nameMap = new Map(mem.map((m) => [m.id, m.name]));
        whoLabel = assigneeIds.map((id) => nameMap.get(id) ?? "지난 멤버").join(", ") || "미지정";
      }
      const lines = ["할 일이 등록되었습니다", `· 할 일: ${title}`, `· 받는 사람: ${whoLabel}`];
      if (detail) lines.push(`· 내용: ${detail}`);
      await prisma.messengerMessage.create({ data: { channelId, memberId: me.id, body: lines.join("\n") } });
      await prisma.messengerRead.upsert({
        where: { memberId_channelId: { memberId: me.id, channelId } },
        create: { memberId: me.id, channelId, lastReadAt: new Date() },
        update: { lastReadAt: new Date() },
      });
    }
  }
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
  const detail = String(formData.get("detail") ?? "").trim().slice(0, 2000) || null;
  const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
  const dueRaw = String(formData.get("due") ?? "").trim();
  await prisma.messengerTask.update({
    where: { id },
    data: { title, detail, assigneeId, dueDate: dueRaw ? kstMidnight(dueRaw) : null },
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
export type CalTaskDTO = { id: string; title: string; due: string; done: boolean; assigneeIds: string[] };

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
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      due: kstDateOf(t.dueDate!),
      done: t.done,
      assigneeIds: t.assigneeIds.length ? t.assigneeIds : t.assigneeId ? [t.assigneeId] : [],
    })),
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
