"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { collectDeposits, type CollectResult } from "@/lib/bank";

export type CollectState = { result?: CollectResult; error?: string };

// 관리자 수동 '지금 수집' — 팝빌에서 최근 입금을 즉시 끌어온다
export async function collectDepositsAction(
  _prev: CollectState,
  _formData: FormData,
): Promise<CollectState> {
  await requireAdmin();
  try {
    const result = await collectDeposits(3);
    revalidatePath("/admin/deposits");
    revalidatePath("/admin/invoices");
    revalidatePath("/admin");
    return { result };
  } catch (err) {
    return { error: (err as Error)?.message ?? "수집에 실패했어요." };
  }
}
