"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { cookies } from "next/headers";
import { signIn, signOut } from "@/auth";
import { SESSION_COOKIE, SESSION_COOKIE_OPTS, createUserSession } from "@/lib/user-session";
import { saveBusinessCert } from "@/lib/storage";
import { notifyAdminSignupRequest } from "@/lib/push";

export type FormState = { error?: string };

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const remember = formData.get("remember") ? "true" : "false";
  // 로그인 후 복귀 경로(same-origin 상대경로만 허용, 없으면 홈). 홈화면 메신저 앱이 /messenger로 돌아오게.
  const nextRaw = String(formData.get("next") ?? "");
  const next = nextRaw.startsWith("/") && !nextRaw.startsWith("//") ? nextRaw : "/";
  if (!username || !password) return { error: "아이디와 비밀번호를 입력하세요." };

  // 옛 세션 정리: 이전 쿠키가 가리키던 행을 revoke (JWT만 만료 후 재로그인 시 옛 행이 '유령 기기'로
  // 남는 것 방지 + 강제로그아웃 후 재로그인 루프 방지).
  const jar = await cookies();
  const oldSid = jar.get(SESSION_COOKIE)?.value;
  if (oldSid) {
    await prisma.userSession
      .update({ where: { id: oldSid }, data: { revokedAt: new Date() } })
      .catch(() => {});
    jar.delete(SESSION_COOKIE);
  }

  // '로그인 즉시 기록' — 비밀번호를 미리 확인(signIn 이 리다이렉트로 throw 하므로 그 전에)해서
  // 로그인 성공이면 세션 레코드를 바로 만들고 hd_sid 쿠키를 심는다. 앱을 열지 않아도 관리자
  // '로그인 현황'에 즉시 뜬다. 실패면 아무것도 안 만들고 아래 signIn 이 에러를 돌려준다.
  try {
    const u = await prisma.user.findUnique({
      where: { username },
      select: { id: true, passwordHash: true },
    });
    if (u && (await bcrypt.compare(password, u.passwordHash))) {
      const newSid = await createUserSession(u.id);
      if (newSid) jar.set(SESSION_COOKIE, newSid, SESSION_COOKIE_OPTS);
    }
  } catch (e) {
    console.error("[login] 세션 선기록 실패:", e);
  }

  try {
    await signIn("credentials", { username, password, remember, redirectTo: next });
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };
    }
    throw e; // redirect 등은 그대로 전달
  }
  return {};
}

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const storeName = String(formData.get("storeName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const payerName = String(formData.get("payerName") ?? "").trim().slice(0, 60);
  const cert = formData.get("businessCert");

  if (username.length < 3) return { error: "아이디는 3자 이상 입력하세요." };
  if (!/^[a-zA-Z0-9_.-]+$/.test(username))
    return { error: "아이디는 영문/숫자만 사용할 수 있습니다." };
  if (password.length < 4) return { error: "비밀번호는 4자 이상 입력하세요." };
  if (!storeName) return { error: "상호명을 입력하세요." };
  if (!phone) return { error: "연락처를 입력하세요." };
  if (!address) return { error: "업장 소재지를 입력하세요." };

  const exists = await prisma.user.findUnique({ where: { username } });
  if (exists) return { error: "이미 사용 중인 아이디입니다." };

  let businessCert: string | null = null;
  try {
    businessCert = await saveBusinessCert(cert instanceof File ? cert : null);
  } catch (err) {
    console.error("[signup] cert save failed:", err);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  try {
    await prisma.user.create({
      data: {
        username,
        passwordHash,
        storeName,
        phone,
        address,
        businessCert,
        payerNames: payerName ? [payerName] : [],
        role: "APPLICANT",
        status: "PENDING",
      },
    });
  } catch (err) {
    // 동시 가입 경쟁으로 unique 위반 시 일관된 메시지 (DB unique를 최종 진실로)
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: string }).code === "P2002"
    ) {
      return { error: "이미 사용 중인 아이디입니다." };
    }
    console.error("[signup] create failed:", err);
    return { error: "가입에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // #10 관리자에게 가입요청 푸시(+인앱 알림). 실패해도 가입 흐름엔 영향 없음.
  await notifyAdminSignupRequest(storeName).catch(() => {});

  try {
    await signIn("credentials", {
      username,
      password,
      remember: "true",
      redirectTo: "/",
    });
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "가입은 완료됐어요. 로그인 화면에서 로그인해 주세요." };
    }
    throw e;
  }
  return {};
}

export async function logoutAction(): Promise<void> {
  // 정상 로그아웃도 이 기기의 서버 세션을 무효 처리 → 관리자 '접속 현황'에서 사라진다.
  const jar = await cookies();
  const sid = jar.get(SESSION_COOKIE)?.value;
  if (sid) {
    await prisma.userSession
      .update({ where: { id: sid }, data: { revokedAt: new Date() } })
      .catch(() => {});
    jar.delete(SESSION_COOKIE);
  }
  await signOut({ redirectTo: "/login" });
}
