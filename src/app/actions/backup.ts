"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { dispatchWorkflow } from "@/lib/github-backup";

// 지금 백업 — DB/미디어 워크플로를 수동 실행(workflow_dispatch).
export async function triggerBackupAction(
  which: "db" | "media" | "both",
): Promise<{ ok: boolean }> {
  await requireAdmin();
  const files: string[] = [];
  if (which === "db" || which === "both") files.push("db-backup.yml");
  if (which === "media" || which === "both") files.push("media-backup.yml");
  const results = await Promise.all(files.map(dispatchWorkflow));
  revalidatePath("/admin/backup");
  return { ok: results.length > 0 && results.every(Boolean) };
}

// 복원 자동검증 지금 실행 — 최신 백업이 진짜 복원되는지 확인.
export async function triggerRestoreVerifyAction(): Promise<{ ok: boolean }> {
  await requireAdmin();
  const ok = await dispatchWorkflow("restore-verify.yml");
  revalidatePath("/admin/backup");
  return { ok };
}
