"use server";

import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";

export type ProfileState = { error?: string };

export async function updateProfileAction(
  _prev: ProfileState,
  formData: FormData,
): Promise<ProfileState> {
  const user = await requireUser();
  if (user.status !== "APPROVED") redirect("/pending");

  const storeName = String(formData.get("storeName") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!storeName || !phone || !address) return { error: "빈 칸을 채워주세요." };

  const data: { storeName: string; phone: string; address: string; passwordHash?: string } = {
    storeName,
    phone,
    address,
  };
  if (password) {
    if (password.length < 4) return { error: "비밀번호는 4자 이상 입력하세요." };
    data.passwordHash = await bcrypt.hash(password, 12);
  }

  await prisma.user.update({ where: { id: user.id }, data });
  redirect("/mypage?saved=1");
}
