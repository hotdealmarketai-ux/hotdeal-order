"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import {
  collectDeposits,
  tryAutoPayInvoice,
  type CollectResult,
} from "@/lib/bank";

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

function revalidateDeposit() {
  revalidatePath("/admin/deposits");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
}

// 미매칭 입금을 관리자가 특정 점포로 수동 매칭.
// remember=true면 그 입금자명을 점포에 기억(다음부턴 자동매칭), 금액 일치 계산서 1장이면 자동 입금확인.
export async function matchDepositManuallyAction(formData: FormData) {
  await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const remember = formData.get("remember") === "true";
  if (!depositId || !userId) return;

  const [dep, store] = await Promise.all([
    prisma.deposit.findUnique({ where: { id: depositId } }),
    prisma.user.findUnique({ where: { id: userId } }),
  ]);
  if (!dep || !store || !isMerchant(store.role as Role)) return;
  if (dep.matchStatus === "AUTO" || dep.matchStatus === "MANUAL") return; // 이미 매칭됨

  await prisma.deposit.update({
    where: { id: depositId },
    data: { matchStatus: "MANUAL", matchedUserId: userId, matchedAt: new Date() },
  });

  // 입금자명 기억 — 다음 동일 입금자명은 자동매칭
  if (remember && dep.payerName && !store.payerNames.includes(dep.payerName)) {
    await prisma.user.update({
      where: { id: userId },
      data: { payerNames: { set: [...store.payerNames, dep.payerName].slice(0, 20) } },
    });
  }

  // 금액 정확 일치 계산서 1장이면 자동 입금확인
  await tryAutoPayInvoice(userId, dep.amount, dep.txAt);
  revalidateDeposit();
}

// 매칭 해제 — 다시 미매칭으로(오매칭 복구). 계산서 입금확인은 별도로 되돌려야 함.
export async function unmatchDepositAction(formData: FormData) {
  await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;
  await prisma.deposit.updateMany({
    where: { id: depositId, matchStatus: { in: ["AUTO", "MANUAL"] } },
    data: { matchStatus: "UNMATCHED", matchedUserId: null, matchedAt: null },
  });
  revalidateDeposit();
}

// 무시 — 점포 입금이 아닌 건(이자·본사 자금이동 등). 큐에서 제외.
export async function ignoreDepositAction(formData: FormData) {
  await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;
  await prisma.deposit.updateMany({
    where: { id: depositId, matchStatus: "UNMATCHED" },
    data: { matchStatus: "IGNORED" },
  });
  revalidateDeposit();
}

// 무시/해제 되돌리기 → 미매칭
export async function resetDepositAction(formData: FormData) {
  await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;
  await prisma.deposit.updateMany({
    where: { id: depositId, matchStatus: "IGNORED" },
    data: { matchStatus: "UNMATCHED" },
  });
  revalidateDeposit();
}
