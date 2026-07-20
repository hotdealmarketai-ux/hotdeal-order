"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { setDailyForceOpen } from "@/lib/order-open";

// 관리자 전역: 일반발주 발주창 임시 오픈(개발/특례) — 운영시간이 아니어도 발주 가능.
export async function setDailyForceOpenAction(formData: FormData) {
  const admin = await requireAdmin();
  const on = String(formData.get("on") ?? "") === "true";
  await setDailyForceOpen(on);
  await writeAudit({
    action: "daily.forceOpen",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `일반발주 임시 오픈 ${on ? "ON" : "OFF"}`,
  });
  revalidatePath("/admin/hotdeal");
  revalidatePath("/order");
  revalidatePath("/inventory");
}
