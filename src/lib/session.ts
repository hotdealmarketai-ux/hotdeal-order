import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { Role, Status } from "@/lib/constants";
import { isAdmin, isMerchant, isVendor } from "@/lib/constants";

export type AppUser = {
  id: string;
  username: string;
  role: Role;
  status: Status;
  storeName: string;
  phone: string;
  address: string;
  businessCert: string | null;
};

export async function getCurrentUser(): Promise<AppUser | null> {
  try {
    const session = await auth();
    const uid = session?.user?.id;
    if (!uid) return null;
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

/** 업자(서부일광/장흥/채움채/새롭) 전용 */
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
