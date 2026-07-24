"use server";

import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import { notifyChatToAdmin, notifyChatToMerchant } from "@/lib/push";
import { logError } from "@/lib/log";

const ADMIN: Role = "ADMIN_SAEROP";

export type ChatRole = "admin" | "merchant";
export type ChatMsg = {
  id: string;
  mine: boolean; // 뷰어가 보낸 메시지
  body: string;
  at: string; // ISO
  readAt: string | null; // 수신자가 읽은 시각
};
export type ChatThreadItem = {
  threadId: string;
  storeName: string;
  last: string;
  lastAt: string;
  unread: number;
};

type Viewer =
  | { kind: "admin"; id: string }
  | { kind: "merchant"; id: string; storeName: string };

async function getViewer(): Promise<Viewer | null> {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED") return null;
  if (user.role === ADMIN) return { kind: "admin", id: user.id };
  if (isMerchant(user.role))
    return { kind: "merchant", id: user.id, storeName: user.storeName };
  return null;
}

async function getOrCreateThread(merchantId: string) {
  // upsert로 동시 생성 경합(P2002) 방지. #9 리뷰
  return prisma.chatThread.upsert({
    where: { merchantId },
    update: {},
    create: { merchantId },
  });
}

type Row = {
  id: string;
  fromAdmin: boolean;
  body: string;
  createdAt: Date;
  readAt: Date | null;
};
function serialize(rows: Row[], viewerIsAdmin: boolean): ChatMsg[] {
  return rows.map((m) => ({
    id: m.id,
    mine: m.fromAdmin === viewerIsAdmin,
    body: m.body,
    at: m.createdAt.toISOString(),
    readAt: m.readAt ? m.readAt.toISOString() : null,
  }));
}

// ── 미읽음 개수 ──
async function merchantUnread(merchantId: string): Promise<number> {
  const t = await prisma.chatThread.findUnique({
    where: { merchantId },
    select: { id: true, merchantClearedAt: true },
  });
  if (!t) return 0;
  return prisma.chatMessage.count({
    where: {
      threadId: t.id,
      fromAdmin: true,
      readAt: null,
      ...(t.merchantClearedAt ? { createdAt: { gt: t.merchantClearedAt } } : {}),
    },
  });
}
async function adminUnread(): Promise<number> {
  // 스레드마다 count 쿼리(N+1) 대신 단일 JOIN 집계 — 폴링(5초)마다 스레드 수만큼 쿼리하던 것 제거.
  // 스레드별 adminClearedAt 이후 메시지만(비운 시각 반영).
  const rows = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT COUNT(*)::bigint AS n
    FROM "ChatMessage" m
    JOIN "ChatThread" t ON m."threadId" = t."id"
    WHERE m."fromAdmin" = false
      AND m."readAt" IS NULL
      AND (t."adminClearedAt" IS NULL OR m."createdAt" > t."adminClearedAt")
  `;
  return Number(rows[0]?.n ?? 0);
}

// ── bootstrap: 역할 + 미읽음(플로팅 배지용) ──
export async function chatBootstrap(): Promise<{
  role: ChatRole;
  unread: number;
} | null> {
  const v = await getViewer();
  if (!v) return null;
  if (v.kind === "admin") return { role: "admin", unread: await adminUnread() };
  return { role: "merchant", unread: await merchantUnread(v.id) };
}

// 배지 폴링용(가벼움)
export async function chatUnread(): Promise<number> {
  const v = await getViewer();
  if (!v) return 0;
  return v.kind === "admin" ? adminUnread() : merchantUnread(v.id);
}

// ── 가맹점주: 내 대화 열기(+ 관리자 메시지 읽음 처리) ──
export async function merchantLoadChat(): Promise<{
  threadId: string;
  messages: ChatMsg[];
} | null> {
  const v = await getViewer();
  if (!v || v.kind !== "merchant") return null;
  const t = await getOrCreateThread(v.id);
  await prisma.chatMessage.updateMany({
    where: {
      threadId: t.id,
      fromAdmin: true,
      readAt: null,
      ...(t.merchantClearedAt ? { createdAt: { gt: t.merchantClearedAt } } : {}),
    },
    data: { readAt: new Date() },
  });
  const rows = await prisma.chatMessage.findMany({
    where: {
      threadId: t.id,
      ...(t.merchantClearedAt ? { createdAt: { gt: t.merchantClearedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, fromAdmin: true, body: true, createdAt: true, readAt: true },
  });
  return { threadId: t.id, messages: serialize(rows, false) };
}

// ── 관리자: 대화 목록(인스타 DM식) ──
export async function adminLoadThreads(): Promise<ChatThreadItem[] | null> {
  const v = await getViewer();
  if (!v || v.kind !== "admin") return null;
  const threads = await prisma.chatThread.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: { merchant: { select: { storeName: true } } },
  });
  const out: ChatThreadItem[] = [];
  for (const t of threads) {
    // 관리자가 비운 이후 메시지만 목록의 last/미리보기로 — 대화창(adminLoadThread)과 일치.
    const last = await prisma.chatMessage.findFirst({
      where: {
        threadId: t.id,
        ...(t.adminClearedAt ? { createdAt: { gt: t.adminClearedAt } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: { body: true, createdAt: true, fromAdmin: true },
    });
    if (!last) continue; // 비운 뒤 남은 메시지 없으면 목록에서 제외
    const unread = await prisma.chatMessage.count({
      where: {
        threadId: t.id,
        fromAdmin: false,
        readAt: null,
        ...(t.adminClearedAt ? { createdAt: { gt: t.adminClearedAt } } : {}),
      },
    });
    out.push({
      threadId: t.id,
      storeName: t.merchant.storeName,
      last: (last.fromAdmin ? "나: " : "") + last.body,
      lastAt: last.createdAt.toISOString(),
      unread,
    });
  }
  return out;
}

// ── 관리자: 특정 대화 열기(+ 가맹점 메시지 읽음) ──
export async function adminLoadThread(threadId: string): Promise<{
  threadId: string;
  storeName: string;
  messages: ChatMsg[];
} | null> {
  const v = await getViewer();
  if (!v || v.kind !== "admin") return null;
  const t = await prisma.chatThread.findUnique({
    where: { id: threadId },
    include: { merchant: { select: { storeName: true } } },
  });
  if (!t) return null;
  await prisma.chatMessage.updateMany({
    where: {
      threadId: t.id,
      fromAdmin: false,
      readAt: null,
      ...(t.adminClearedAt ? { createdAt: { gt: t.adminClearedAt } } : {}),
    },
    data: { readAt: new Date() },
  });
  const rows = await prisma.chatMessage.findMany({
    where: {
      threadId: t.id,
      ...(t.adminClearedAt ? { createdAt: { gt: t.adminClearedAt } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: 300,
    select: { id: true, fromAdmin: true, body: true, createdAt: true, readAt: true },
  });
  return { threadId: t.id, storeName: t.merchant.storeName, messages: serialize(rows, true) };
}

// ── 전송 ──
export async function sendChat(
  body: string,
  threadId?: string,
): Promise<{ ok: boolean; error?: string }> {
  const v = await getViewer();
  if (!v) return { ok: false, error: "로그인이 필요해요." };
  const text = String(body ?? "").trim().slice(0, 2000);
  if (!text) return { ok: false, error: "" };

  // 남용 방지 — 같은 발신자가 0.4초 내 연속 전송하면 무시(스크립트 폭주 차단). #9 리뷰
  // 관리자는 여러 스레드에 빠르게 답장할 수 있으므로 제외(스팸 방어는 점주 대상만).
  if (v.kind !== "admin") {
    const recent = await prisma.chatMessage.findFirst({
      where: { senderId: v.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < 400) {
      return { ok: false, error: "" };
    }
  }

  try {
    if (v.kind === "merchant") {
      const t = await getOrCreateThread(v.id);
      await prisma.$transaction([
        prisma.chatMessage.create({
          data: { threadId: t.id, senderId: v.id, fromAdmin: false, body: text },
        }),
        prisma.chatThread.update({
          where: { id: t.id },
          data: { lastMessageAt: new Date() },
        }),
      ]);
      await notifyChatToAdmin(v.storeName, text, t.id);
    } else {
      // 관리자 → 특정 가맹점 스레드
      if (!threadId) return { ok: false, error: "대화를 선택하세요." };
      const t = await prisma.chatThread.findUnique({ where: { id: threadId } });
      if (!t) return { ok: false, error: "대화를 찾을 수 없어요." };
      await prisma.$transaction([
        prisma.chatMessage.create({
          data: { threadId: t.id, senderId: v.id, fromAdmin: true, body: text },
        }),
        prisma.chatThread.update({
          where: { id: t.id },
          data: { lastMessageAt: new Date() },
        }),
      ]);
      await notifyChatToMerchant(t.merchantId, text, t.id);
    }
    return { ok: true };
  } catch (err) {
    logError("chat.send", err, {});
    return { ok: false, error: "전송에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }
}

// ── 내 화면에서만 대화 비우기(soft) ──
export async function clearChat(threadId: string): Promise<{ ok: boolean }> {
  const v = await getViewer();
  if (!v) return { ok: false };
  const t = await prisma.chatThread.findUnique({ where: { id: threadId } });
  if (!t) return { ok: false };
  if (v.kind === "merchant" && t.merchantId !== v.id) return { ok: false };
  const now = new Date();
  await prisma.chatThread.update({
    where: { id: t.id },
    data: v.kind === "admin" ? { adminClearedAt: now } : { merchantClearedAt: now },
  });
  return { ok: true };
}
