import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role, Status } from "@/lib/constants";
import { isAdmin, isMerchant, isVendor } from "@/lib/constants";
import {
  SESSION_COOKIE,
  TOUCH_THROTTLE_MS,
  readSessionRow,
  touchSession,
} from "@/lib/user-session";

export type AppUser = {
  id: string;
  username: string;
  role: Role;
  status: Status;
  storeName: string;
  phone: string;
  address: string;
  businessCert: string | null;
  orderUnlock: boolean;
  orderUnlockAt: Date | null;
  weeklyOrderUnlock: boolean;
  weeklyOrderUnlockAt: Date | null;
  onboardingStartedAt: Date | null;
  onboardingCompletedAt: Date | null;
  reservationEnabled: boolean;
  sid: string | null; // 이 로그인(기기)의 서버 세션 id — 강제 로그아웃/접속 현황용
};

export async function getCurrentUser(): Promise<AppUser | null> {
  try {
    const session = await auth();
    const uid = session?.user?.id;
    if (!uid) return null;
    // 이 기기의 서버 세션(hd_sid 쿠키)이 강제/정상 로그아웃(revoked)됐으면 즉시 비로그인 처리
    // → 다음 이동에서 /login. 쿠키가 없으면(로그인 직후·ping 전) 통과(ping이 생성/설정).
    let sid: string | null = null;
    try {
      const sidCookie = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
      if (sidCookie) {
        const row = await readSessionRow(sidCookie);
        if (row && row.userId === uid) {
          if (row.revokedAt) return null; // 강제/정상 로그아웃됨
          sid = sidCookie;
          if (Date.now() - row.lastSeenAt.getTime() > TOUCH_THROTTLE_MS) {
            await touchSession(sidCookie);
          }
        }
        // row 없음 또는 다른 계정 쿠키(공용기기 잔상) → 무시. ping이 새로 만든다.
      }
    } catch (e) {
      console.error("[session] hd_sid 검사 실패:", e);
    }
    const u = await prisma.user.findUnique({ where: { id: uid } });
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      role: u.role as Role,
      status: u.status as Status,
      storeName: u.storeName,
      phone: u.phone,
      address: u.address,
      businessCert: u.businessCert,
      orderUnlock: u.orderUnlock,
      orderUnlockAt: u.orderUnlockAt,
      weeklyOrderUnlock: u.weeklyOrderUnlock,
      weeklyOrderUnlockAt: u.weeklyOrderUnlockAt,
      onboardingStartedAt: u.onboardingStartedAt,
      onboardingCompletedAt: u.onboardingCompletedAt,
      reservationEnabled: u.reservationEnabled,
      sid,
    };
  } catch (err) {
    // DB 미연결/장애 시 앱이 죽지 않고 비로그인으로 처리(로그인 화면 표시)
    console.error("[session] getCurrentUser failed (DB 연결 확인):", err);
    return null;
  }
}

/** 로그인 필수 — 아니면 /login 으로 */
export async function requireUser(): Promise<AppUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** 승인된 점주(가맹점/소매) 전용 */
export async function requireMerchant(): Promise<AppUser> {
  const user = await requireUser();
  if (user.status !== "APPROVED") redirect("/pending");
  if (!isMerchant(user.role)) redirect("/login");
  return user;
}

/** 업자(서부일광/조은팜/채움채/새롭) 전용 */
export async function requireVendor(): Promise<AppUser> {
  const user = await requireUser();
  if (user.status !== "APPROVED") redirect("/pending");
  if (!isVendor(user.role)) redirect("/login");
  return user;
}

/** 새롭(관리자) 전용 */
export async function requireAdmin(): Promise<AppUser> {
  const user = await requireUser();
  if (user.status !== "APPROVED") redirect("/pending");
  if (!isAdmin(user.role)) redirect("/login");
  return user;
}

