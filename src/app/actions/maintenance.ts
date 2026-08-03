"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { setMaintenance, MAINTENANCE_PASSWORD } from "@/lib/maintenance";
import { writeAudit } from "@/lib/audit";

// 패치(유지보수) 모드 토글 — 관리자 전용.
// ON 전환은 비밀번호(1234) 필수(화면 확인 + 서버 재검증). OFF는 관리자면 즉시 해제(바로 사용 재개).
export async function setMaintenanceAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const on = formData.get("on") === "true";
  const password = String(formData.get("password") ?? "").trim();

  if (on && password !== MAINTENANCE_PASSWORD) {
    return { error: "비밀번호가 올바르지 않아요." };
  }

  await setMaintenance(on);
  await writeAudit({
    action: on ? "maintenance.on" : "maintenance.off",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "system",
    targetId: "maintenance",
    summary: `패치(유지보수) 모드 ${on ? "ON — 가맹점 사용 차단" : "OFF — 사용 재개"}`,
  }).catch(() => {});

  // 관리자 홈(토글 상태) + 가맹점 레이아웃(차단/해제) 즉시 반영.
  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return {};
}
