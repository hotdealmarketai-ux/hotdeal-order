"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { INVPC_UNLOCK_COOKIE } from "@/lib/inventory-pc-auth";

// 창고관리와 동일한 방식의 비밀번호 게이트(관리자 로그인 + 세션 쿠키). 근무 중 한 번만 입력.
const INVPC_PASSWORD = "1234";

export async function unlockInventoryPcAction(formData: FormData) {
  await requireAdmin();
  const pw = String(formData.get("password") ?? "");
  if (pw !== INVPC_PASSWORD) redirect("/inventory-pc?pw=bad");
  const jar = await cookies();
  jar.set(INVPC_UNLOCK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 만료 없음 = 세션 쿠키(브라우저 닫으면 해제).
  });
  redirect("/inventory-pc");
}
