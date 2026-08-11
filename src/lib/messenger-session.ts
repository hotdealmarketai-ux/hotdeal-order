import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";

// 사내 메신저 '2차 로그인' 세션 — 1차(공용 새롭 관리자)와 별개로 개인 신원을 식별한다.
// httpOnly 쿠키에 memberId 를 AUTH_SECRET HMAC 로 서명해 저장(변조 방지). 1차 관리자 게이트 뒤에서만 쓰인다.
const COOKIE = "msgr";
const SECRET = process.env.AUTH_SECRET ?? "dev-only";

function sign(id: string): string {
  const h = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  return `${id}.${h}`;
}
function unsign(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const id = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", SECRET).update(id).digest("base64url");
  if (mac.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  } catch {
    return null;
  }
  return id;
}

// 쿠키 쓰기/삭제는 서버 액션·라우트 핸들러에서만 호출(렌더 중 X).
export async function setMessengerMemberCookie(id: string) {
  const c = await cookies();
  c.set(COOKIE, sign(id), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}
export async function clearMessengerMemberCookie() {
  const c = await cookies();
  c.delete(COOKIE);
}
export async function getMessengerMemberId(): Promise<string | null> {
  const c = await cookies();
  const t = c.get(COOKIE)?.value;
  return t ? unsign(t) : null;
}

// 현재 2차 로그인된 멤버(활성). 없거나 비활성이면 null.
export async function getMessengerMember(): Promise<{ id: string; name: string } | null> {
  const id = await getMessengerMemberId();
  if (!id) return null;
  const m = await prisma.messengerMember.findUnique({ where: { id } });
  return m && m.active ? { id: m.id, name: m.name } : null;
}

export async function hashPin(pin: string) {
  return bcrypt.hash(pin, 10);
}
export async function verifyPin(pin: string, pinHash: string) {
  return bcrypt.compare(pin, pinHash);
}
