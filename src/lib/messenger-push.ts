// 사내 메신저 웹푸시(서버 전용). 멤버 단위 구독으로 발송. 비공개키 없으면 조용히 무시.
// 핫딜오더 User 기반 푸시(src/lib/push.ts)와 별개 — 메신저는 전원 공용 saerop로 1차 로그인하므로
// User가 아니라 MessengerMember 단위로 타깃해야 개인별 알림이 된다. 서비스워커·VAPID는 동일 재사용.
import { prisma } from "@/lib/prisma";
import { VAPID_PUBLIC_KEY } from "@/lib/vapid";
import { logError } from "@/lib/log";

const VAPID_SUBJECT = "mailto:hotdealmarketai@gmail.com";

export type MsgrPushPayload = { title: string; body: string; url?: string };

// web-push는 서버에서만 동적 import(클라 번들 제외). 비공개키 없으면 null.
async function getWebPush() {
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!priv) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import("web-push");
  const webpush = mod.default ?? mod;
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, priv);
  return webpush;
}

// 한 발송이 죽은 엔드포인트에 매달려 함수를 점유하지 않도록 8초 타임아웃(라이브러리 버전 무관하게 race).
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("push-timeout")), ms))]);
}

// 특정 멤버들에게 발송(중복 id 제거). 만료 구독(404/410)은 정리.
export async function sendMessengerPush(memberIds: string[], payload: MsgrPushPayload) {
  const ids = [...new Set(memberIds.filter(Boolean))];
  if (ids.length === 0) return;
  const webpush = await getWebPush();
  if (!webpush) return;
  const subs = await prisma.messengerPushSubscription.findMany({ where: { memberId: { in: ids } } });
  if (subs.length === 0) return;
  const data = JSON.stringify({ ...payload, url: payload.url ?? "/messenger", type: "messenger" });
  await Promise.all(
    subs.map(async (s) => {
      try {
        await withTimeout(webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, data), 8000);
      } catch (err) {
        const code = (err as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await prisma.messengerPushSubscription.delete({ where: { endpoint: s.endpoint } }).catch(() => {});
        } else {
          logError("msgrPush.send", err, { endpoint: s.endpoint, status: code });
        }
      }
    }),
  );
}

// 활성 멤버 id 캐시 — 메시지 폭주 시 메시지당 멤버 전체조회를 막는다(인스턴스별 30초 TTL).
let _activeIdsCache: { at: number; ids: string[] } | null = null;
async function allActiveIds(): Promise<string[]> {
  const now = Date.now();
  if (_activeIdsCache && now - _activeIdsCache.at < 30_000) return _activeIdsCache.ids;
  const ms = await prisma.messengerMember.findMany({ where: { active: true }, select: { id: true } });
  _activeIdsCache = { at: now, ids: ms.map((m) => m.id) };
  return _activeIdsCache.ids;
}

// 활성 멤버 id 목록(발신자 제외).
export async function activeMemberIdsExcept(exceptId: string): Promise<string[]> {
  return (await allActiveIds()).filter((id) => id !== exceptId);
}

// 목적격 조사 을/를 — 받침 있으면 '을', 없으면 '를'(한글 아니면 '을'로 안전).
function josaEulReul(word: string): string {
  const ch = word.trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 === 0 ? "를" : "을";
  return "을";
}

const clip = (s: string, n = 120) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ── 새 채팅 메시지 ──────────────────────────────────────────
// 발신자 제외 전원에게 '누가 · 무엇을' 만 간결히. 멘션 대상만 '언급' 문구로 구분(수신자당 1건).
export async function notifyMessengerMessage(opts: {
  senderId: string;
  senderName: string;
  channelId: string;
  text: string;
  mediaKind: "image" | "file" | null;
  mentionedIds: string[];
}) {
  const { senderId, senderName, channelId, text, mediaKind, mentionedIds } = opts;
  const all = new Set(await activeMemberIdsExcept(senderId));
  if (all.size === 0) return;
  const url = `/messenger?ch=${channelId}`;
  const preview = text ? clip(text) : mediaKind === "file" ? "파일을 보냈습니다" : "사진을 보냈습니다";

  const mentioned = mentionedIds.filter((id) => all.has(id));
  const mentionedSet = new Set(mentioned);
  const others = [...all].filter((id) => !mentionedSet.has(id));

  await Promise.all([
    sendMessengerPush(mentioned, { title: `${senderName}님이 회원님을 언급했습니다`, body: preview, url }),
    // 일반 메시지: 제목=보낸 사람, 내용=메시지(누가 뭐라고 보냈는지만).
    sendMessengerPush(others, { title: senderName, body: preview, url }),
  ]);
}

// ── 할 일 배정(등록) ────────────────────────────────────────
export async function notifyMessengerTaskAssigned(opts: {
  creatorId: string;
  creatorName: string;
  title: string;
  toAll: boolean;
  assigneeIds: string[];
}) {
  const { creatorId, creatorName, title, toAll, assigneeIds } = opts;
  const targets = toAll ? await activeMemberIdsExcept(creatorId) : assigneeIds.filter((id) => id !== creatorId);
  await sendMessengerPush(targets, {
    title: toAll ? `${creatorName}님이 팀 전체에 할 일을 등록했습니다` : `${creatorName}님이 할 일을 배정했습니다`,
    body: clip(title),
    url: "/messenger?view=mytasks",
  });
}

// ── 할 일 완료 ──────────────────────────────────────────────
// 완료한 사람 제외, 등록자 + 함께 배정된 사람에게.
export async function notifyMessengerTaskDone(opts: {
  doneById: string;
  doneByName: string;
  title: string;
  createdById: string;
  toAll: boolean;
  assigneeIds: string[];
}) {
  const { doneById, doneByName, title, createdById, toAll, assigneeIds } = opts;
  const set = new Set<string>();
  if (createdById) set.add(createdById);
  if (toAll) (await activeMemberIdsExcept(doneById)).forEach((id) => set.add(id));
  else assigneeIds.forEach((id) => set.add(id));
  set.delete(doneById);
  await sendMessengerPush([...set], {
    title: "할 일이 완료되었습니다",
    body: `${doneByName}님이 '${clip(title, 60)}'${josaEulReul(title)} 완료했습니다`,
    url: "/messenger?view=mytasks",
  });
}

// ── 할 일 개인별 완료 ──────────────────────────────────────
// 개인이 자기 완료를 체크하면 작성자에게 '○○님이 완료' 알림(누가 했는지 확인용).
export async function notifyMessengerTaskCompleted(creatorId: string, doneByName: string, title: string) {
  if (!creatorId) return;
  await sendMessengerPush([creatorId], {
    title: "할 일이 완료되었습니다",
    body: `${doneByName}님이 '${clip(title, 60)}'${josaEulReul(title)} 완료했습니다`,
    url: "/messenger?view=mytasks",
  });
}

// ── 공지 등록 ──────────────────────────────────────────────
export async function notifyMessengerNotice(opts: {
  actorId: string;
  channelId: string;
  channelName: string;
  text: string;
}) {
  const { actorId, channelId, channelName, text } = opts;
  const targets = await activeMemberIdsExcept(actorId);
  await sendMessengerPush(targets, {
    title: "새 공지가 등록되었습니다",
    body: `# ${channelName} · ${text ? clip(text) : "사진"}`,
    url: `/messenger?ch=${channelId}`,
  });
}

// ── 회의록 등록 ────────────────────────────────────────────
export async function notifyMessengerMinutes(opts: { actorId: string; dateLabel: string }) {
  const targets = await activeMemberIdsExcept(opts.actorId);
  await sendMessengerPush(targets, {
    title: "새 회의록이 올라왔어요",
    body: `${opts.dateLabel} 회의록을 확인해 보세요`,
    url: "/messenger?view=minutes",
  });
}

// ── 오늘 일정(캘린더) 아침 알림 — 크론에서 호출 ──────────────
export async function notifyMessengerTodayAgenda(titles: string[]) {
  if (titles.length === 0) return;
  const ms = await prisma.messengerMember.findMany({ where: { active: true }, select: { id: true } });
  await sendMessengerPush(
    ms.map((m) => m.id),
    {
      title: `오늘 일정이 ${titles.length}건 있습니다`,
      body: clip(titles.join(", ")),
      url: "/messenger",
    },
  );
}
