"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
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

  // 수동 매칭은 '이 입금은 이 점포 것'이라는 귀속만 한다.
  // 계산서 완납 확정은 관리자가 '수동 입금확인'으로 명시적으로 하도록 분리(오확정 방지).
  revalidateDeposit();
}

// 매칭 해제 — 다시 미매칭으로(오매칭 복구).
// 이미 계산서에 '귀속(입금확인)'된 입금은 그냥 풀면(옛 버그#9) 원장에서 입금이 사라지는데
// 계산서는 PAID로 남아 잔액/미수가 어긋난다 → 귀속된 입금은 먼저 계산서 '입금확인 취소'를 하도록 차단.
// (unmarkInvoicePaidAction이 appliedInvoiceId 정리 + 합성입금 삭제 + PAID→ISSUED 원복을 한 번에 처리)
export async function unmatchDepositAction(formData: FormData): Promise<{ error?: string } | void> {
  await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;
  const dep = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: { matchStatus: true, appliedInvoiceId: true },
  });
  if (!dep || (dep.matchStatus !== "AUTO" && dep.matchStatus !== "MANUAL")) return;
  if (dep.appliedInvoiceId) {
    return {
      error:
        "이 입금은 계산서 대금으로 반영돼 있어요. 먼저 해당 계산서에서 '입금확인 취소'를 한 뒤 매칭을 해제해 주세요.",
    };
  }
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

// 발주 잠금 해제/재잠금 — 관리자가 임의 출고 시 미납이어도 발주 허용(orderUnlock).
// 완납되면 자동으로 다시 잠긴다(clearOrderUnlockIfSettled).
export async function setOrderUnlockAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const unlock = formData.get("unlock") === "true";
  if (!userId) return;
  // 1회성 해제: 해제 시각을 기록 → orderLockOf가 '현재 발주창'에서만 인정, 다음 창엔 재잠금.
  await prisma.user.update({
    where: { id: userId },
    data: { orderUnlock: unlock, orderUnlockAt: unlock ? new Date() : null },
  });
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${userId}`);
  revalidatePath(`/admin/members/${userId}`);
  revalidatePath("/order");
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
