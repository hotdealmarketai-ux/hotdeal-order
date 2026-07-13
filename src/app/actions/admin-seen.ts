"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { markAdminSeen, type AdminSeenSurface } from "@/lib/admin-seen";

// #25 관리자가 해당 화면에 들어오면 '본 시각'을 갱신 → 홈 배지에서 그 이후 새 건만 카운트.
export async function markAdminSeenAction(surface: AdminSeenSurface) {
  await requireAdmin();
  await markAdminSeen(surface);
  revalidatePath("/admin");
}
