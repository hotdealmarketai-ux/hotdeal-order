import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";

// 로그인(기기)별 서버 세션 추적 — JWT는 무상태라, 활성 로그인 목록/개별 강제 로그아웃을 위해
// 전용 쿠키(hd_sid)로 UserSession 레코드를 가리킨다. 쿠키는 ping 라우트/로그인·로그아웃 액션에서만
// 설정·삭제하고(모두 쿠키 설정 가능 컨텍스트), 서버 컴포넌트(getCurrentUser)는 읽기만 한다.
export const SESSION_COOKIE = "hd_sid";
export const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 400, // 자동 로그인 JWT 상한과 동일
  secure: process.env.NODE_ENV === "production",
};

export const ONLINE_WINDOW_MS = 3 * 60 * 1000; // 마지막 활동 3분 이내면 '접속 중'
export const TOUCH_THROTTLE_MS = 45 * 1000; // lastSeenAt 갱신 최소 간격

async function readClient(): Promise<{ ua: string; ip: string }> {
  try {
    const h = await headers();
    const ua = h.get("user-agent") ?? "";
    const ip =
      (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || (h.get("x-real-ip") ?? "");
    return { ua: ua.slice(0, 400), ip: ip.slice(0, 64) };
  } catch {
    return { ua: "", ip: "" };
  }
}

// 로그인(기기) 세션 레코드 생성 → id 반환. 실패해도 로그인은 막지 않는다(null).
export async function createUserSession(userId: string): Promise<string | null> {
  try {
    const { ua, ip } = await readClient();
    const s = await prisma.userSession.create({ data: { userId, userAgent: ua, ip } });
    return s.id;
  } catch (e) {
    console.error("[user-session] 생성 실패:", e);
    return null;
  }
}

export type SessionRow = { userId: string; revokedAt: Date | null; lastSeenAt: Date };

export async function readSessionRow(sid: string): Promise<SessionRow | null> {
  try {
    return await prisma.userSession.findUnique({
      where: { id: sid },
      select: { userId: true, revokedAt: true, lastSeenAt: true },
    });
  } catch (e) {
    console.error("[user-session] 조회 실패:", e);
    return null;
  }
}

// lastSeenAt 갱신(스로틀은 호출부에서 lastSeenAt로 판단). 실패는 조용히 무시.
export async function touchSession(sid: string): Promise<void> {
  await prisma.userSession
    .update({ where: { id: sid }, data: { lastSeenAt: new Date() } })
    .catch(() => {});
}

export type AdminSessionRow = {
  id: string;
  device: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  online: boolean;
};
export type AdminSessionGroup = {
  userId: string;
  storeName: string;
  username: string;
  role: string;
  onlineCount: number;
  total: number;
  sessions: AdminSessionRow[];
};

// 가맹점(MERCHANT_*)의 활성(미취소) 로그인 세션을 지점별로 묶어 반환 — 관리자 '접속 현황'용.
export async function listMerchantSessions(): Promise<AdminSessionGroup[]> {
  const rows = await prisma.userSession.findMany({
    where: { revokedAt: null, user: { role: { startsWith: "MERCHANT_" } } },
    select: {
      id: true,
      userAgent: true,
      ip: true,
      createdAt: true,
      lastSeenAt: true,
      userId: true,
      user: { select: { storeName: true, username: true, role: true } },
    },
    orderBy: { lastSeenAt: "desc" },
  });
  const now = Date.now();
  const map = new Map<string, AdminSessionGroup & { _last: number }>();
  for (const r of rows) {
    const last = r.lastSeenAt.getTime();
    const online = now - last <= ONLINE_WINDOW_MS;
    let g = map.get(r.userId);
    if (!g) {
      g = {
        userId: r.userId,
        storeName: r.user.storeName,
        username: r.user.username,
        role: r.user.role,
        onlineCount: 0,
        total: 0,
        sessions: [],
        _last: last,
      };
      map.set(r.userId, g);
    }
    g.sessions.push({
      id: r.id,
      device: deviceLabel(r.userAgent),
      userAgent: r.userAgent,
      ip: r.ip,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
      online,
    });
    g.total += 1;
    if (online) g.onlineCount += 1;
    g._last = Math.max(g._last, last);
  }
  return [...map.values()]
    .sort((a, b) => b.onlineCount - a.onlineCount || b._last - a._last)
    .map(({ _last, ...g }) => {
      void _last;
      return g;
    });
}

// 기기 라벨(표시용) — UA에서 OS/브라우저를 대략 추출
export function deviceLabel(ua: string): string {
  if (!ua) return "알 수 없는 기기";
  const os = /iPhone|iPad|iPod/i.test(ua)
    ? "iPhone/iPad"
    : /Android/i.test(ua)
      ? "Android"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Macintosh|Mac OS/i.test(ua)
          ? "Mac"
          : /Linux/i.test(ua)
            ? "Linux"
            : "기타 기기";
  const br = /KAKAOTALK/i.test(ua)
    ? "카카오톡"
    : /NAVER|Whale/i.test(ua)
      ? "네이버/웨일"
      : /Edg/i.test(ua)
        ? "Edge"
        : /CriOS|Chrome/i.test(ua)
          ? "Chrome"
          : /FxiOS|Firefox/i.test(ua)
            ? "Firefox"
            : /Safari/i.test(ua)
              ? "Safari"
              : "브라우저";
  return `${os} · ${br}`;
}
