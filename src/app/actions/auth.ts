"use server";

import { AuthError } from "next-auth";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signIn, signOut } from "@/auth";
import { saveBusinessCert } from "@/lib/storage";

export type FormState = { error?: string };

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { error: "아이디와 비밀번호를 입력하세요." };

  try {
    await signIn("credentials", { username, password, redirectTo: "/" });
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

  try {
    await signIn("credentials", { username, password, redirectTo: "/" });
  } catch (e) {
    if (e instanceof AuthError) {
      return { error: "가입은 완료됐어요. 로그인 화면에서 로그인해 주세요." };
    }
    throw e;
  }
  return {};
}

export async function logoutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
