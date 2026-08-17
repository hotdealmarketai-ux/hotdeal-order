"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { del } from "@vercel/blob";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { kstDateOf } from "@/lib/date";
import {
  notifyMessengerMessage,
  notifyMessengerTaskAssigned,
  notifyMessengerTaskCompleted,
  notifyMessengerNotice,
  notifyMessengerMinutes,
} from "@/lib/messenger-push";
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

// ── 웹푸시 구독(멤버 단위) ──────────────────────────────────
// 브라우저 구독을 현재 2차 로그인 멤버에게 귀속(endpoint 유니크 → 소유자 갱신).
// 같은 기기서 멤버 전환 시 마지막 로그인 멤버에게 알림이 가도록(핫딜오더 User 푸시와 별개 테이블).
export async function saveMessengerPushSubscriptionAction(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
}): Promise<{ ok: boolean }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !sub?.endpoint || !sub.p256dh || !sub.auth) return { ok: false };
  await prisma.messengerPushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    update: { memberId: me.id, p256dh: sub.p256dh, auth: sub.auth },
    create: { memberId: me.id, endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
  });
  return { ok: true };
}

export async function removeMessengerPushSubscriptionAction(endpoint: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  if (endpoint) await prisma.messengerPushSubscription.deleteMany({ where: { endpoint } });
  return { ok: true };
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
  // 일반 파일 첨부(문서 등).
  const fileUrl = String(formData.get("fileUrl") ?? "").trim() || null;
  const fileName = String(formData.get("fileName") ?? "").trim().slice(0, 200) || null;
  if (!channelId) return { error: "채널을 선택하세요." };
  if (!body && !mediaUrl && mediaUrls.length === 0 && !fileUrl) return { error: "" }; // 빈 전송 무시

  const ch = await prisma.messengerChannel.findFirst({ where: { id: channelId, archived: false } });
  if (!ch) return { error: "채널을 찾을 수 없어요." };

  // 답장(대댓글) — 원본 미리보기 비정규화 저장.
  const replyToId = String(formData.get("replyToId") ?? "").trim() || null;
  const replyToName = String(formData.get("replyToName") ?? "").trim().slice(0, 30) || null;
  const replyToBody = String(formData.get("replyToBody") ?? "").trim().slice(0, 120) || null;

  const msg = await prisma.messengerMessage.create({
    data: { channelId, memberId: me.id, body, mediaUrl, mediaType, mediaUrls, fileUrl, fileName, replyToId, replyToName, replyToBody },
  });

  // @멘션 파싱 — 본문에 "@이름"이 있으면 그 멤버를 언급으로 기록(본인 제외). 홈 멘션 토픽용.
  // 단어 경계로 매칭: '@민수'가 이름 '민'을 오탐하지 않게(뒤에 한글/영숫자/밑줄이 오면 매칭 안 함).
  let mentionedIds: string[] = [];
  if (body.includes("@")) {
    const members = await prisma.messengerMember.findMany({ where: { active: true }, select: { id: true, name: true } });
    const preview = (body || "사진").slice(0, 140);
    const escapeRx = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hit = members.filter(
      (m) => m.id !== me.id && m.name && new RegExp(`@${escapeRx(m.name)}(?![0-9A-Za-z가-힣_])`).test(body),
    );
    mentionedIds = hit.map((m) => m.id);
    if (hit.length)
      await prisma.messengerMention.createMany({
        data: hit.map((m) => ({ channelId, messageId: msg.id, mentionedMemberId: m.id, byMemberId: me.id, preview })),
      });
  }

  // 보낸 사람은 그 채널을 방금 읽은 것으로.
  await prisma.messengerRead.upsert({
    where: { memberId_channelId: { memberId: me.id, channelId } },
    create: { memberId: me.id, channelId, lastReadAt: new Date() },
    update: { lastReadAt: new Date() },
  });

  // 웹푸시 — 발신자 제외 전원에게 '누가·무엇을'(멘션 대상만 언급 문구). 응답 막지 않게 after()로.
  after(() =>
    notifyMessengerMessage({
      senderId: me.id,
      senderName: me.name,
      channelId,
      text: body,
      mediaKind: fileUrl ? "file" : mediaUrl || mediaUrls.length ? "image" : null,
      mentionedIds,
    }).catch(() => {}),
  );

  revalidatePath("/messenger");
  return {};
}

// 메시지 전송 취소(삭제) — 본인이 보낸 메시지만.
export async function deleteMessengerMessageAction(messageId: string): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !messageId) return { error: "" };
  const msg = await prisma.messengerMessage.findUnique({
    where: { id: messageId },
    select: { memberId: true, mediaUrl: true, mediaUrls: true, fileUrl: true },
  });
  if (!msg) return {};
  if (msg.memberId !== me.id) return { error: "내가 보낸 메시지만 취소할 수 있어요." };
  await prisma.messengerMention.deleteMany({ where: { messageId } }).catch(() => {});
  await prisma.messengerReaction.deleteMany({ where: { messageId } }).catch(() => {});
  // 행 삭제가 실제로 성공했을 때만 Blob 정리 — 삭제 실패 시 살아있는 메시지의 미디어를 지워버리지 않게.
  const deleted = await prisma.messengerMessage.delete({ where: { id: messageId } }).then(() => true).catch(() => false);
  if (deleted) {
    const urls = [msg.mediaUrl, ...(msg.mediaUrls ?? []), msg.fileUrl].filter((u): u is string => !!u);
    if (urls.length) after(() => del(urls).catch(() => {}));
  }
  return {};
}

// 메시지 수정 — 본인이 보낸 메시지의 본문만. (재알림·멘션 재파싱 없음: 오타 수정 용도)
export async function editMessengerMessageAction(messageId: string, body: string): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !messageId) return { error: "" };
  const msg = await prisma.messengerMessage.findUnique({ where: { id: messageId }, select: { memberId: true } });
  if (!msg) return {};
  if (msg.memberId !== me.id) return { error: "내가 보낸 메시지만 수정할 수 있어요." };
  const next = body.trim().slice(0, 4000);
  if (!next) return { error: "내용을 입력하세요." };
  await prisma.messengerMessage.update({ where: { id: messageId }, data: { body: next } });
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
  fileUrl: string | null; // 일반 파일 첨부
  fileName: string | null;
  replyToId: string | null; // 답장 원본 메시지 id — 인용문 클릭 시 그 위치로 점프
  replyToName: string | null;
  replyToBody: string | null;
  notice: boolean;
  reactions: string[]; // 공감(체크)한 멤버 이름들
  reactedByMe: boolean;
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
        fileUrl: true, fileName: true, replyToId: true, replyToName: true, replyToBody: true, noticeAt: true,
        member: { select: { name: true } },
      },
    })
  ).reverse();
  // ⚠ 읽음 처리는 여기서 하지 않는다(3초 폴링마다 write가 나가 Neon 컴퓨트를 24시간 깨워두는 문제).
  //   클라(ChatPane)가 '새 메시지가 실제로 도착했을 때'만 markMessengerReadAction 을 호출한다.
  // 공감(체크) 반응 — 이 300개 메시지에 달린 반응을 한 번에 모아 메시지별 이름/내 반응 여부로 정리.
  const ids = rows.map((m) => m.id);
  const reacts = ids.length
    ? await prisma.messengerReaction.findMany({ where: { messageId: { in: ids } }, select: { messageId: true, memberId: true } })
    : [];
  // 반응이 하나도 없으면 멤버 이름맵 조회 자체를 건너뛴다(매 3초 폴링 낭비 방지).
  const nameById = reacts.length
    ? new Map((await prisma.messengerMember.findMany({ select: { id: true, name: true } })).map((m) => [m.id, m.name]))
    : new Map<string, string>();
  const reactByMsg = new Map<string, { names: string[]; mine: boolean }>();
  for (const r of reacts) {
    const cur = reactByMsg.get(r.messageId) ?? { names: [], mine: false };
    cur.names.push(nameById.get(r.memberId) ?? "지난 멤버");
    if (r.memberId === me.id) cur.mine = true;
    reactByMsg.set(r.messageId, cur);
  }
  return {
    messages: rows.map((m) => ({
      id: m.id,
      memberId: m.memberId,
      memberName: m.member.name,
      body: m.body,
      mediaUrl: m.mediaUrl,
      mediaType: m.mediaType,
      mediaUrls: m.mediaUrls ?? [],
      fileUrl: m.fileUrl,
      fileName: m.fileName,
      replyToId: m.replyToId,
      replyToName: m.replyToName,
      replyToBody: m.replyToBody,
      notice: !!m.noticeAt,
      reactions: reactByMsg.get(m.id)?.names ?? [],
      reactedByMe: reactByMsg.get(m.id)?.mine ?? false,
      at: m.createdAt.toISOString(),
    })),
  };
}

// 메시지 공감(체크) — 클라가 원하는 최종 상태(on)를 넘겨 멱등하게 반영(빠른 더블탭 경합 방지).
// 누가 눌렀는지는 로드 시 이름으로 표시.
export async function toggleMessengerReactionAction(messageId: string, on: boolean): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !messageId) return { error: "" };
  const msg = await prisma.messengerMessage.findUnique({ where: { id: messageId }, select: { id: true } });
  if (!msg) return { error: "메시지를 찾을 수 없어요." };
  if (on) {
    await prisma.messengerReaction
      .upsert({ where: { messageId_memberId: { messageId, memberId: me.id } }, create: { messageId, memberId: me.id }, update: {} })
      .catch(() => {});
  } else {
    await prisma.messengerReaction.deleteMany({ where: { messageId, memberId: me.id } });
  }
  return {};
}

// 공지 등록/해제 — 공지는 채널당 1개(등록 시 기존 공지 자동 해제).
export async function toggleMessengerNoticeAction(messageId: string, on: boolean): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !messageId) return;
  const msg = await prisma.messengerMessage.findUnique({
    where: { id: messageId },
    select: { channelId: true, body: true, noticeAt: true, channel: { select: { name: true } } },
  });
  if (!msg) return;
  if (on) {
    const wasNotice = !!msg.noticeAt;
    await prisma.messengerMessage.updateMany({ where: { channelId: msg.channelId, noticeAt: { not: null } }, data: { noticeAt: null } });
    const ok = await prisma.messengerMessage
      .update({ where: { id: messageId }, data: { noticeAt: new Date() } })
      .then(() => true)
      .catch(() => false);
    // 실제로 공지가 새로 설정됐을 때만 전체 브로드캐스트(업데이트 실패·이미 공지였던 경우 제외).
    if (ok && !wasNotice)
      after(() =>
        notifyMessengerNotice({ actorId: me.id, channelId: msg.channelId, channelName: msg.channel?.name ?? "", text: msg.body }).catch(() => {}),
      );
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
  const [events, allTasks] = await Promise.all([
    prisma.messengerEvent.findMany({ where: { date: { gte: start, lt: end } }, orderBy: { date: "asc" } }),
    prisma.messengerTask.findMany({
      // 나와 관련된 것만(팀원 전체거나 내가 배정) — 남의 할일이 내 '이번 주 일정'에 안 뜨게.
      where: { dueDate: { gte: start, lt: end }, OR: [{ toAll: true }, { assigneeIds: { has: me.id } }] },
      orderBy: { dueDate: "asc" },
    }),
  ]);
  // 내가 이미 완료한 태스크는 '이번 주 일정'에서 제외(개인별 완료 기준).
  const allTaskIds = allTasks.map((t) => t.id);
  const myDoneIds = allTaskIds.length
    ? new Set(
        (await prisma.messengerTaskCompletion.findMany({ where: { taskId: { in: allTaskIds }, memberId: me.id }, select: { taskId: true } })).map(
          (c) => c.taskId,
        ),
      )
    : new Set<string>();
  const tasks = allTasks.filter((t) => !myDoneIds.has(t.id));
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
  // 이 멤버의 반복 할일 + 완료 마커(문자열 참조, FK 없음)도 정리 — 고아 데이터 방지.
  const recIds = (await prisma.messengerRecurringTask.findMany({ where: { memberId: id }, select: { id: true } })).map((t) => t.id);
  if (recIds.length) {
    await prisma.messengerRecurringCompletion.deleteMany({ where: { taskId: { in: recIds } } }).catch(() => {});
    await prisma.messengerRecurringTask.deleteMany({ where: { memberId: id } }).catch(() => {});
  }
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
  // 삭제 전에 채널 메시지들의 첨부 Blob URL 수집 → 원본 정리(고아 파일 방지).
  const withMedia = await prisma.messengerMessage.findMany({
    where: { channelId: id, OR: [{ mediaUrl: { not: null } }, { fileUrl: { not: null } }, { mediaUrls: { isEmpty: false } }] },
    select: { mediaUrl: true, mediaUrls: true, fileUrl: true },
  });
  const urls = withMedia.flatMap((m) => [m.mediaUrl, ...(m.mediaUrls ?? []), m.fileUrl]).filter((u): u is string => !!u);
  await prisma.messengerMention.deleteMany({ where: { channelId: id } }).catch(() => {});
  await prisma.messengerChannel.delete({ where: { id } }).catch(() => {});
  if (urls.length)
    after(async () => {
      for (let i = 0; i < urls.length; i += 100) await del(urls.slice(i, i + 100)).catch(() => {});
    });
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
  done: boolean; // ★ '현재 보는 사람'이 완료했는지(개인별). 그룹핑(열림/완료)은 이 값 기준.
  assigneeId: string | null; // (레거시) 단일
  assigneeIds: string[]; // 받는 사람(다중)
  toAll: boolean; // 받는 사람 = 팀원 전체
  due: string | null; // yyyy-mm-dd(KST) | null
  createdById: string; // 보낸 사람(시킨 사람)
  createdAt: string;
  doneAt: string | null;
  completedNames: string[]; // 완료 체크한 사람 이름들(취합 표시용)
  canComplete: boolean; // 내가 체크할 수 있는지 = 팀원 전체거나 배정받은 사람
};

type TaskRow = {
  id: string; title: string; detail: string | null; done: boolean; doneAt: Date | null;
  assigneeId: string | null; assigneeIds: string[]; toAll: boolean; dueDate: Date | null;
  createdById: string; createdAt: Date;
};

// 태스크 행 → DTO. 개인별 완료(MessengerTaskCompletion) 취합: done=내 완료, completedNames=완료자들.
async function enrichTaskDTOs(rows: TaskRow[], meId: string): Promise<TaskDTO[]> {
  const ids = rows.map((r) => r.id);
  const comps = ids.length
    ? await prisma.messengerTaskCompletion.findMany({ where: { taskId: { in: ids } }, select: { taskId: true, memberId: true } })
    : [];
  const nameById = comps.length
    ? new Map((await prisma.messengerMember.findMany({ select: { id: true, name: true } })).map((m) => [m.id, m.name]))
    : new Map<string, string>();
  const byTask = new Map<string, { names: string[]; mine: boolean; ids: Set<string> }>();
  for (const c of comps) {
    const cur = byTask.get(c.taskId) ?? { names: [], mine: false, ids: new Set<string>() };
    cur.names.push(nameById.get(c.memberId) ?? "지난 멤버");
    cur.ids.add(c.memberId);
    if (c.memberId === meId) cur.mine = true;
    byTask.set(c.taskId, cur);
  }
  return rows.map((t) => {
    const assignees = t.assigneeIds.length ? t.assigneeIds : t.assigneeId ? [t.assigneeId] : [];
    const comp = byTask.get(t.id);
    const canComplete = t.toAll || assignees.includes(meId);
    // 배정받은 사람 전원이 완료했는지 — 배정 안 받은 사람에겐 이걸로 '완료' 표시(체크·완료그룹).
    const allAssigneesDone = assignees.length > 0 && assignees.every((id) => comp?.ids.has(id) ?? false);
    return {
      id: t.id,
      title: t.title,
      detail: t.detail,
      // 배정받았으면 '내 완료', 아니면 '배정자 전원 완료'로 완료 여부를 본다.
      done: canComplete ? (comp?.mine ?? false) : allAssigneesDone,
      assigneeId: t.assigneeId,
      assigneeIds: assignees,
      toAll: t.toAll,
      due: t.dueDate ? kstDateOf(t.dueDate) : null,
      createdById: t.createdById,
      createdAt: t.createdAt.toISOString(),
      doneAt: t.doneAt ? t.doneAt.toISOString() : null,
      completedNames: comp?.names ?? [],
      canComplete,
    };
  });
}

export async function loadMessengerTasksAction(): Promise<{ tasks: TaskDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { tasks: [] };
  const rows = await prisma.messengerTask.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
  return { tasks: await enrichTaskDTOs(rows, me.id) };
}

// 내 할일 — 나에게 배정된(또는 팀원 전체) 할일만.
export async function loadMyMessengerTasksAction(): Promise<{ tasks: TaskDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { tasks: [] };
  const rows = await prisma.messengerTask.findMany({
    where: { OR: [{ toAll: true }, { assigneeIds: { has: me.id } }] },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  return { tasks: await enrichTaskDTOs(rows, me.id) };
}

// 할 일 개인별 완료 토글 — 배정받은 사람(또는 팀원 전체)만. on=클라가 계산한 최종상태(멱등).
export async function toggleMessengerTaskCompletionAction(taskId: string, on: boolean): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !taskId) return { error: "" };
  const t = await prisma.messengerTask.findUnique({
    where: { id: taskId },
    select: { title: true, createdById: true, toAll: true, assigneeIds: true, assigneeId: true },
  });
  if (!t) return { error: "할 일을 찾을 수 없어요." };
  const assignees = t.assigneeIds.length ? t.assigneeIds : t.assigneeId ? [t.assigneeId] : [];
  if (!(t.toAll || assignees.includes(me.id))) return { error: "배정받은 사람만 완료 체크할 수 있어요." };
  if (on) {
    await prisma.messengerTaskCompletion
      .upsert({ where: { taskId_memberId: { taskId, memberId: me.id } }, create: { taskId, memberId: me.id }, update: {} })
      .catch(() => {});
    // 작성자에게 '○○님이 완료' 알림(본인이 작성자면 생략).
    if (t.createdById && t.createdById !== me.id)
      after(() => notifyMessengerTaskCompleted(t.createdById, me.name, t.title).catch(() => {}));
  } else {
    await prisma.messengerTaskCompletion.deleteMany({ where: { taskId, memberId: me.id } });
  }
  return {};
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
  // 배정받은 사람(또는 팀 전체)에게 웹푸시.
  after(() => notifyMessengerTaskAssigned({ creatorId: me.id, creatorName: me.name, title, toAll, assigneeIds }).catch(() => {}));
  revalidatePath("/messenger");
  return {};
}

// (구) 전체 done 토글은 개인별 완료(toggleMessengerTaskCompletionAction)로 대체됨 — 제거.

// 할 일 수정 — 올린 사람(createdById)만 가능. 받는 사람(다중/전체)도 수정.
export async function updateMessengerTaskAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "" };
  const existing = await prisma.messengerTask.findUnique({ where: { id }, select: { createdById: true } });
  if (!existing) return { error: "할 일을 찾을 수 없어요." };
  if (existing.createdById !== me.id) return { error: "올린 사람만 수정할 수 있어요." };
  const title = String(formData.get("title") ?? "").trim().slice(0, 300);
  if (!title) return { error: "할 일을 입력하세요." };
  const detail = String(formData.get("detail") ?? "").trim().slice(0, 2000) || null;
  const toAll = String(formData.get("toAll") ?? "") === "1";
  const assigneeIds = toAll ? [] : [...new Set(formData.getAll("assigneeIds").map((v) => String(v).trim()).filter(Boolean))];
  if (!toAll && assigneeIds.length === 0) return { error: "받는 사람을 선택하세요." };
  // dueDate 는 이 UI에 입력칸이 없어 건드리지 않는다(기존 값 보존).
  await prisma.messengerTask.update({
    where: { id },
    data: { title, detail, toAll, assigneeIds, assigneeId: assigneeIds[0] ?? null },
  });
  // 배정에서 빠진 사람의 완료 기록 정리(전체 배정이면 전원 가능하니 유지).
  if (!toAll) await prisma.messengerTaskCompletion.deleteMany({ where: { taskId: id, memberId: { notIn: assigneeIds } } }).catch(() => {});
  revalidatePath("/messenger");
  return {};
}

export async function deleteMessengerTaskAction(id: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  await prisma.messengerTaskCompletion.deleteMany({ where: { taskId: id } }).catch(() => {});
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
  // done = '내 개인별 완료' 여부(다른 사람 완료와 무관하게 각자 기준).
  const taskIds = tasks.map((t) => t.id);
  const myDone = taskIds.length
    ? new Set(
        (await prisma.messengerTaskCompletion.findMany({ where: { taskId: { in: taskIds }, memberId: me.id }, select: { taskId: true } })).map(
          (c) => c.taskId,
        ),
      )
    : new Set<string>();
  return {
    events: events.map((e) => ({ id: e.id, title: e.title, date: kstDateOf(e.date), memo: e.memo, createdById: e.createdById })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      due: kstDateOf(t.dueDate!),
      done: myDone.has(t.id),
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

// 등록된 일정 수정 — 제목·날짜·메모(팀 공용이라 멤버 누구나, 삭제와 동일 권한).
export async function updateMessengerEventAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "" };
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  const date = kstMidnight(String(formData.get("date") ?? "").trim());
  if (!title) return { error: "일정 제목을 입력하세요." };
  if (!date) return { error: "날짜를 확인하세요." };
  const memo = String(formData.get("memo") ?? "").trim().slice(0, 1000) || null;
  await prisma.messengerEvent.update({ where: { id }, data: { title, date, memo } }).catch(() => {});
  revalidatePath("/messenger");
  return {};
}

// ── 반복(기본) 할일 + 조직도 ─────────────────────────────────
// 요청(배정) 할일과 별개. 멤버 각자 매일/특정요일 체크리스트. 추가·수정·삭제 누구나, 체크는 본인만.
// 완료는 날짜별(그날 KST) 마커 → 자정 자동 리셋. 요일 비트마스크 days(bit i=요일 i, 0=일). 127=매일.
export type RecurringDTO = {
  id: string;
  memberId: string;
  title: string;
  days: number; // 요일 비트마스크
  appliesToday: boolean; // 오늘 요일에 해당
  done: boolean; // 오늘 체크됨(해당분만 의미)
  canCheck: boolean; // 지금 사용자가 체크 가능(본인 & 오늘 해당)
};
export type OrgMemberDTO = { id: string; name: string; total: number; done: number };

// YYYY-MM-DD → 요일(0=일…6=토). 달력상 요일(타임존 무관).
function dowOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1)).getUTCDay();
}
const appliesOn = (days: number, dow: number) => ((days >> dow) & 1) === 1;

// 내 반복 할일 — '오늘 요일 해당'분만(내 할일 화면 '기본 내 할일' 섹션).
export async function loadMyRecurringTasksAction(): Promise<{ tasks: RecurringDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { tasks: [] };
  const today = kstDateOf(new Date());
  const dow = dowOfYmd(today);
  const rows = await prisma.messengerRecurringTask.findMany({ where: { memberId: me.id }, orderBy: { sortOrder: "asc" } });
  const applicable = rows.filter((r) => appliesOn(r.days, dow));
  const comps = applicable.length
    ? await prisma.messengerRecurringCompletion.findMany({ where: { taskId: { in: applicable.map((r) => r.id) }, date: today }, select: { taskId: true } })
    : [];
  const doneSet = new Set(comps.map((c) => c.taskId));
  return {
    tasks: applicable.map((r) => ({ id: r.id, memberId: r.memberId, title: r.title, days: r.days, appliesToday: true, done: doneSet.has(r.id), canCheck: true })),
  };
}

// 반복 할일 완료 토글 — 본인(주인)만. on=최종상태(멱등). 오늘 날짜 마커로 기록(자정 리셋).
export async function toggleRecurringCompletionAction(taskId: string, on: boolean): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !taskId) return { error: "" };
  const t = await prisma.messengerRecurringTask.findUnique({ where: { id: taskId }, select: { memberId: true, days: true } });
  if (!t) return { error: "" };
  if (t.memberId !== me.id) return { error: "본인 반복 할일만 체크할 수 있어요." };
  const today = kstDateOf(new Date());
  if (!appliesOn(t.days, dowOfYmd(today))) return { error: "오늘 요일에 해당하지 않는 할일이에요." };
  if (on) {
    await prisma.messengerRecurringCompletion
      .upsert({ where: { taskId_date: { taskId, date: today } }, create: { taskId, date: today }, update: {} })
      .catch(() => {});
  } else {
    await prisma.messengerRecurringCompletion.deleteMany({ where: { taskId, date: today } });
  }
  return {};
}

// 반복 할일 추가 — 누구나(대상 멤버 지정). days=요일 비트마스크(1~127).
export async function addRecurringTaskAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const memberId = String(formData.get("memberId") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  let days = Math.trunc(Number(formData.get("days") ?? 127));
  if (!Number.isFinite(days) || days < 1 || days > 127) days = 127;
  if (!memberId) return { error: "대상 멤버를 선택하세요." };
  if (!title) return { error: "반복 할일을 입력하세요." };
  const member = await prisma.messengerMember.findUnique({ where: { id: memberId }, select: { id: true } });
  if (!member) return { error: "멤버를 찾을 수 없어요." };
  const max = await prisma.messengerRecurringTask.aggregate({ where: { memberId }, _max: { sortOrder: true } });
  await prisma.messengerRecurringTask.create({ data: { memberId, title, days, createdById: me.id, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  return {};
}

// 반복 할일 수정(제목·요일) — 누구나.
export async function updateRecurringTaskAction(formData: FormData): Promise<{ error?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "메신저 로그인이 필요해요." };
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "" };
  const title = String(formData.get("title") ?? "").trim().slice(0, 200);
  let days = Math.trunc(Number(formData.get("days") ?? 127));
  if (!Number.isFinite(days) || days < 1 || days > 127) days = 127;
  if (!title) return { error: "반복 할일을 입력하세요." };
  await prisma.messengerRecurringTask.update({ where: { id }, data: { title, days } }).catch(() => {});
  return {};
}

// 반복 할일 삭제 — 누구나. 완료 마커도 함께 정리.
export async function deleteRecurringTaskAction(id: string): Promise<void> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return;
  await prisma.messengerRecurringCompletion.deleteMany({ where: { taskId: id } });
  await prisma.messengerRecurringTask.delete({ where: { id } }).catch(() => {});
}

// 조직도 — 전 멤버 + 오늘 반복 할일 진행률(완료수/오늘해당수).
export async function loadOrgChartAction(): Promise<{ members: OrgMemberDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { members: [] };
  const today = kstDateOf(new Date());
  const dow = dowOfYmd(today);
  const [members, tasks] = await Promise.all([
    prisma.messengerMember.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    prisma.messengerRecurringTask.findMany({ select: { id: true, memberId: true, days: true } }),
  ]);
  const todayTasks = tasks.filter((t) => appliesOn(t.days, dow));
  const idsByMember = new Map<string, string[]>();
  for (const t of todayTasks) {
    const arr = idsByMember.get(t.memberId) ?? [];
    arr.push(t.id);
    idsByMember.set(t.memberId, arr);
  }
  const allIds = todayTasks.map((t) => t.id);
  const comps = allIds.length
    ? await prisma.messengerRecurringCompletion.findMany({ where: { taskId: { in: allIds }, date: today }, select: { taskId: true } })
    : [];
  const doneSet = new Set(comps.map((c) => c.taskId));
  return {
    members: members.map((m) => {
      const ids = idsByMember.get(m.id) ?? [];
      return { id: m.id, name: m.name, total: ids.length, done: ids.filter((id) => doneSet.has(id)).length };
    }),
  };
}

// 조직도 멤버 상세 — 그 멤버의 반복 할일 전체(오늘 해당 여부·체크) + 내가 체크 가능한지.
export async function loadMemberRecurringAction(memberId: string): Promise<{ name: string; canCheck: boolean; tasks: RecurringDTO[] }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !memberId) return { name: "", canCheck: false, tasks: [] };
  const today = kstDateOf(new Date());
  const dow = dowOfYmd(today);
  const [member, rows] = await Promise.all([
    prisma.messengerMember.findUnique({ where: { id: memberId }, select: { name: true } }),
    prisma.messengerRecurringTask.findMany({ where: { memberId }, orderBy: { sortOrder: "asc" } }),
  ]);
  const todayIds = rows.filter((r) => appliesOn(r.days, dow)).map((r) => r.id);
  const comps = todayIds.length
    ? await prisma.messengerRecurringCompletion.findMany({ where: { taskId: { in: todayIds }, date: today }, select: { taskId: true } })
    : [];
  const doneSet = new Set(comps.map((c) => c.taskId));
  const mine = memberId === me.id;
  return {
    name: member?.name ?? "지난 멤버",
    canCheck: mine,
    tasks: rows.map((r) => {
      const appliesToday = appliesOn(r.days, dow);
      return { id: r.id, memberId, title: r.title, days: r.days, appliesToday, done: appliesToday && doneSet.has(r.id), canCheck: mine && appliesToday };
    }),
  };
}

// ── 회의록 ──────────────────────────────────────────────────
export type MinutesDTO = {
  id: string;
  date: string; // yyyy-mm-dd (KST)
  agenda: string | null;
  imageUrls: string[];
  uploaderId: string;
  uploaderName: string;
  readers: { id: string; name: string }[];
  readByMe: boolean;
  mine: boolean;
};

// 회의록 목록 — 최신 회의 날짜 우선(같은 날은 올린 순 역순). 업로더·읽은 사람 이름까지 채워 반환.
export async function loadMessengerMinutesAction(): Promise<MinutesDTO[]> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return [];
  const rows = await prisma.messengerMinutes.findMany({
    orderBy: [{ meetingDate: "desc" }, { createdAt: "desc" }],
    include: { reads: { select: { memberId: true, readAt: true } } },
  });
  if (rows.length === 0) return [];
  // 이름 맵(업로더 + 읽은 사람 전원, 지난 멤버 포함).
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.memberId);
    for (const rd of r.reads) ids.add(rd.memberId);
  }
  const members = await prisma.messengerMember.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  const nameOf = new Map(members.map((m) => [m.id, m.name]));
  return rows.map((r) => ({
    id: r.id,
    date: kstDateOf(r.meetingDate),
    agenda: r.agenda,
    imageUrls: r.imageUrls,
    uploaderId: r.memberId,
    uploaderName: nameOf.get(r.memberId) ?? "지난 멤버",
    // 먼저 읽은 사람부터.
    readers: [...r.reads]
      .sort((a, b) => a.readAt.getTime() - b.readAt.getTime())
      .map((rd) => ({ id: rd.memberId, name: nameOf.get(rd.memberId) ?? "지난 멤버" })),
    readByMe: r.reads.some((rd) => rd.memberId === me.id),
    mine: r.memberId === me.id,
  }));
}

// 회의록 사진 최대 장수(클라 MinutesPane의 MAX_IMAGES와 동일하게 유지). "use server" 파일이라 export 금지(비-async).
const MINUTES_MAX_IMAGES = 30;

// 업로드로 만들어진 우리 Blob 스토어 URL만 허용 — 임의 외부/data: URL 주입 차단
// (뷰어 <img src> 비컨·삭제 시 del()의 교차기능 Blob 삭제 방지).
function isOwnBlobUrl(u: string): boolean {
  try {
    const url = new URL(u);
    return url.protocol === "https:" && url.hostname.endsWith(".blob.vercel-storage.com");
  } catch {
    return false;
  }
}

// 회의록 등록 — 날짜/안건/이미지들. 업로더는 읽음 처리, 나머지 팀원에게 푸시.
export async function createMessengerMinutesAction(formData: FormData): Promise<{ error?: string; id?: string }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return { error: "로그인이 필요해요." };
  const ymd = String(formData.get("date") ?? "").trim();
  const date = kstMidnight(ymd);
  if (!date) return { error: "회의 날짜를 선택하세요." };
  const agenda = String(formData.get("agenda") ?? "").trim().slice(0, 2000);
  const imageUrls = formData.getAll("imageUrls").map((v) => String(v)).filter(Boolean);
  if (imageUrls.length === 0) return { error: "회의록 이미지를 한 장 이상 올려 주세요." };
  // 초과분을 조용히 잘라내지 않고 명시적으로 거절(유실·고아 Blob 방지).
  if (imageUrls.length > MINUTES_MAX_IMAGES) return { error: `사진은 최대 ${MINUTES_MAX_IMAGES}장까지 올릴 수 있어요.` };
  if (!imageUrls.every(isOwnBlobUrl)) return { error: "이미지 형식이 올바르지 않아요. 다시 업로드해 주세요." };
  const row = await prisma.messengerMinutes.create({
    data: { meetingDate: date, agenda: agenda || null, imageUrls, memberId: me.id },
    select: { id: true },
  });
  // 내가 올린 회의록은 '안읽음'으로 안 뜨게 업로더를 읽음 처리.
  await prisma.messengerMinutesRead.create({ data: { minutesId: row.id, memberId: me.id } }).catch(() => {});
  const [, mm, dd] = ymd.split("-");
  const label = `${Number(mm)}월 ${Number(dd)}일`;
  after(() => notifyMessengerMinutes({ actorId: me.id, dateLabel: label }).catch(() => {}));
  return { id: row.id };
}

// 회의록 읽음 — 최초 읽은 시각 보존(업서트).
export async function markMessengerMinutesReadAction(id: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return { ok: false };
  try {
    await prisma.messengerMinutesRead.upsert({
      where: { minutesId_memberId: { minutesId: id, memberId: me.id } },
      create: { minutesId: id, memberId: me.id },
      update: {},
    });
    return { ok: true };
  } catch {
    return { ok: false }; // 실패를 삼키지 않음 → 클라가 낙관적 '읽음'을 롤백할 수 있게.
  }
}

// 회의록 삭제 — 올린 사람만. 이미지 Blob도 정리(FK Cascade 로 읽음행 동반 삭제).
export async function deleteMessengerMinutesAction(id: string): Promise<{ error?: string; ok?: boolean }> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me || !id) return { error: "" };
  const row = await prisma.messengerMinutes.findUnique({ where: { id }, select: { memberId: true, imageUrls: true } });
  if (!row) return { ok: true };
  if (row.memberId !== me.id) return { error: "내가 올린 회의록만 삭제할 수 있어요." };
  // 진짜 오류(커넥션/타임아웃 등)를 성공으로 오인하지 않게 — 이미 삭제됨(P2025)만 성공 처리.
  try {
    await prisma.messengerMinutes.delete({ where: { id } });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2025") return { ok: true };
    return { error: "삭제에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }
  if (row.imageUrls.length) after(() => del(row.imageUrls).catch(() => {}));
  return { ok: true };
}

// 내가 아직 안 읽은 회의록 수(홈 알림·하단 네비 배지용).
// = 전체 회의록 − 내가 읽은 수(읽음행은 회의록 삭제 시 FK Cascade라 항상 현존분만 카운트).
export async function messengerUnreadMinutesAction(): Promise<number> {
  await requireAdmin();
  const me = await getMessengerMember();
  if (!me) return 0;
  const [total, mineRead] = await Promise.all([
    prisma.messengerMinutes.count(),
    prisma.messengerMinutesRead.count({ where: { memberId: me.id } }),
  ]);
  return Math.max(0, total - mineRead);
}
