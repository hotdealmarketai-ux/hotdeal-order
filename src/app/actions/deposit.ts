"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import { collectDeposits, type CollectResult } from "@/lib/bank";
import { setOrderLockOverride } from "@/lib/order-open";
import { receivableOf } from "@/lib/receivable";
import { formatKDate } from "@/lib/format";
import { writeAudit } from "@/lib/audit";

// 미수 수정 잠금 비밀번호 — 화면 잠금해제와 별개로 서버에서도 반드시 검증(방어).
const RECEIVABLE_EDIT_PASSWORD = "1234";

export type CollectState = { result?: CollectResult; error?: string };

// 미수를 읽는 모든 화면 갱신 — 매칭·수동조정으로 미수가 바뀌면 관리자(입금관리·계산서 발행·계산서/미수)와
// 점주(배지/마이/입금요청서)가 같은 값을 보게 한다. 미수는 여러 화면이 각자 집계하므로 전부 무효화.
function revalidateReceivable(userId: string) {
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${userId}`);
  revalidatePath("/admin/billing");
  revalidatePath(`/admin/billing/${userId}`);
  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
  revalidatePath("/order");
  revalidatePath("/mypage");
  revalidatePath("/invoices");
}

// 미수 수동 조정 — 관리자 전용. 점포 미수를 가감(입금 누락·반품·오류 정정 등).
// mode=delta: direction=plus면 미수 증가(+)/minus면 감소(−)·금액·사유(memo) 필수.
// mode=set: 미수금액을 입력한 숫자로 바로 맞춘다(현재 미수와의 차이만큼 조정을 남김)·사유 선택.
// ⚠ 보안: requireAdmin + 비밀번호(1234) 서버 검증 — 점주는 이 액션에 도달할 수 없고, 잠금해제 없이도 통과 못한다.
export async function adjustReceivableAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const mode = String(formData.get("mode") ?? "delta"); // "delta"(+/−) | "set"(직접 입력)
  const direction = String(formData.get("direction") ?? "plus");
  const password = String(formData.get("password") ?? "").trim();
  let memo = String(formData.get("memo") ?? "").trim().slice(0, 200);
  const magnitude = Math.abs(
    parseInt(String(formData.get("amount") ?? "").replace(/[^\d]/g, ""), 10) || 0,
  );
  if (!userId) return { error: "잘못된 요청이에요." };
  if (password !== RECEIVABLE_EDIT_PASSWORD) {
    return { error: "비밀번호가 올바르지 않아요." };
  }

  const store = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, storeName: true },
  });
  if (!store || !isMerchant(store.role as Role)) {
    return { error: "점포를 찾을 수 없어요." };
  }

  let amount: number;
  if (mode === "set") {
    // 목표 미수액(절대값)으로 맞춘다 — 현재 미수와의 차이만큼만 조정을 기록.
    const target = magnitude;
    const cur = await receivableOf(userId);
    amount = target - cur.balance;
    if (amount === 0) return { error: "미수금액이 이미 그 값이에요." };
    if (!memo) {
      memo = `미수 직접 수정 ${cur.balance.toLocaleString("ko-KR")} → ${target.toLocaleString("ko-KR")}`;
    }
  } else {
    if (magnitude <= 0) return { error: "금액을 입력해 주세요." };
    if (!memo) return { error: "조정 사유를 입력해 주세요." };
    amount = direction === "minus" ? -magnitude : magnitude;
  }

  await prisma.receivableAdjustment.create({
    data: { userId, amount, memo, adminId: admin.id, adminName: admin.storeName },
  });
  await writeAudit({
    action: "receivable.adjust",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "store",
    targetId: userId,
    summary: `${store.storeName} 미수 조정 ${amount > 0 ? "+" : "−"}${Math.abs(amount).toLocaleString("ko-KR")}원 · ${memo}`,
  }).catch(() => {});
  revalidateReceivable(userId);
  return {};
}

// 미수 조정 내역 삭제(되돌리기) — 관리자 전용.
export async function deleteReceivableAdjustmentAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const adj = await prisma.receivableAdjustment.findUnique({
    where: { id },
    select: { userId: true, amount: true, memo: true },
  });
  if (!adj) return;
  await prisma.receivableAdjustment.delete({ where: { id } });
  await writeAudit({
    action: "receivable.adjust.delete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "store",
    targetId: adj.userId,
    summary: `미수 조정 삭제 ${adj.amount > 0 ? "+" : "−"}${Math.abs(adj.amount).toLocaleString("ko-KR")}원 · ${adj.memo}`,
  }).catch(() => {});
  revalidateReceivable(adj.userId);
}

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

// 미매칭 입금을 관리자가 특정 점포로 '수동' 매칭(자동매칭 폐지, 2026-08-05).
// 매칭 = 그 입금을 점포 것으로 표시 + 같은 금액의 −미수조정(ReceivableAdjustment, depositId 링크) 생성.
// → receivableOf(=발행+조정)와 미수를 보는 모든 화면이 이 입금만큼 미수를 자동으로 줄인다.
// 계산서에는 귀속(appliedInvoiceId)하지 않는다 → 계산서 '입금확인'과 이중차감되지 않음(입금확인 자체를 폐지).
// depositId 유니크로 한 입금당 조정 1건(멱등). 매칭 해제 시 이 조정을 삭제해 원복.
export async function matchDepositManuallyAction(formData: FormData) {
  const admin = await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  if (!depositId || !userId) return;

  const [dep, store] = await Promise.all([
    prisma.deposit.findUnique({ where: { id: depositId } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, storeName: true } }),
  ]);
  if (!dep || !store || !isMerchant(store.role as Role)) return;
  if (dep.matchStatus === "AUTO" || dep.matchStatus === "MANUAL") return; // 이미 매칭됨

  const memo = `입금 매칭 · ${dep.payerName || "입금자명 없음"} · ${formatKDate(dep.txAt)}`;
  // 원자적: 미매칭/무시 상태일 때만 매칭으로 '선점'(동시 매칭 방지) + 조정 upsert(depositId 멱등).
  let matched = false;
  await prisma.$transaction(async (tx) => {
    const claim = await tx.deposit.updateMany({
      where: { id: depositId, matchStatus: { in: ["UNMATCHED", "IGNORED"] } },
      data: { matchStatus: "MANUAL", matchedUserId: userId, matchedAt: new Date() },
    });
    if (claim.count === 0) return; // 이미 다른 요청이 매칭함 → 조정 만들지 않음
    matched = true;
    await tx.receivableAdjustment.upsert({
      where: { depositId },
      create: {
        userId,
        amount: -dep.amount,
        memo,
        adminId: admin.id,
        adminName: admin.storeName,
        depositId,
      },
      update: {}, // 이미 있으면 그대로(멱등)
    });
  });
  if (matched) {
    await writeAudit({
      action: "deposit.match",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "store",
      targetId: userId,
      summary: `${store.storeName} 입금 매칭 −${dep.amount.toLocaleString("ko-KR")}원 (입금자 ${dep.payerName || "미상"})`,
    }).catch(() => {});
  }
  revalidateReceivable(userId);
}

// 매칭 해제 — 다시 미매칭으로(오매칭 복구).
// 매칭 시 만든 −미수조정(depositId 링크)을 지워 미수를 원복한다.
// (레거시) 옛 자동매칭이 계산서에 '귀속(appliedInvoiceId)'한 입금은 그냥 풀면 계산서는 PAID로 남아
// 잔액/미수가 어긋난다 → 먼저 계산서 '입금확인 취소'를 하도록 차단(unmarkInvoicePaidAction이 원복 처리).
export async function unmatchDepositAction(formData: FormData): Promise<{ error?: string } | void> {
  const admin = await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;
  const dep = await prisma.deposit.findUnique({
    where: { id: depositId },
    select: {
      matchStatus: true,
      appliedInvoiceId: true,
      matchedUserId: true,
      amount: true,
      payerName: true,
    },
  });
  if (!dep || (dep.matchStatus !== "AUTO" && dep.matchStatus !== "MANUAL")) return;
  if (dep.appliedInvoiceId) {
    return {
      error:
        "이 입금은 계산서 대금으로 반영돼 있어요. 먼저 해당 계산서에서 '입금확인 취소'를 한 뒤 매칭을 해제해 주세요.",
    };
  }
  const matchedUserId = dep.matchedUserId;
  // 원자적: 매칭으로 만든 −조정 삭제 + 입금 UNMATCHED 원복.
  // deleteMany라 링크 조정이 없어도(레거시 자동매칭 등) 조용히 통과 — 미수는 원래대로.
  await prisma.$transaction([
    prisma.receivableAdjustment.deleteMany({ where: { depositId } }),
    prisma.deposit.updateMany({
      where: { id: depositId, matchStatus: { in: ["AUTO", "MANUAL"] } },
      data: { matchStatus: "UNMATCHED", matchedUserId: null, matchedAt: null },
    }),
  ]);
  if (matchedUserId) {
    await writeAudit({
      action: "deposit.unmatch",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "store",
      targetId: matchedUserId,
      summary: `입금 매칭 해제 +${dep.amount.toLocaleString("ko-KR")}원 미수 복원 (입금자 ${dep.payerName || "미상"})`,
    }).catch(() => {});
    revalidateReceivable(matchedUserId);
  } else revalidateDeposit();
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

// 미매칭 입금을 '목록에서 삭제' — 순수하게 조회 목록에서만 제거. 계산서·입금확인·미수와 전혀 무관.
//  · 소프트 삭제(matchStatus=DELETED): bankTid를 보존해 다음 수집에서 되살아나지 않게 한다(하드 삭제면 재수집됨).
//  · 어떤 계산서에도 귀속(appliedInvoiceId) 안 된 미매칭/무시 입금만 대상 — 매칭·미수를 절대 건드리지 않는 안전장치.
export async function deleteDepositAction(formData: FormData) {
  await requireAdmin();
  const depositId = String(formData.get("depositId") ?? "");
  if (!depositId) return;
  await prisma.deposit.updateMany({
    where: {
      id: depositId,
      matchStatus: { in: ["UNMATCHED", "IGNORED"] },
      appliedInvoiceId: null,
    },
    data: { matchStatus: "DELETED" },
  });
  revalidateDeposit();
}

// 1회 잠금해제(통합) — 관리자가 임의 출고 시 미납이어도 발주 허용.
// 이 한 번의 해제로 '일반발주 + 주간발주'가 함께 풀린다(주간 별도 해제는 없앰).
// 완납되면 자동으로 다시 잠긴다(clearOrderUnlockIfSettled / clearWeeklyUnlockIfSettled).
export async function setOrderUnlockAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const unlock = formData.get("unlock") === "true";
  if (!userId) return;
  const at = unlock ? new Date() : null;
  // 1회성 해제: 해제 시각 기록 → orderLockOf/weeklyLockOf가 '그 창/그 주'에서만 인정, 이후 재잠금.
  await prisma.user.update({
    where: { id: userId },
    data: {
      orderUnlock: unlock,
      orderUnlockAt: at,
      weeklyOrderUnlock: unlock,
      weeklyOrderUnlockAt: at,
    },
  });
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${userId}`);
  revalidatePath(`/admin/members/${userId}`);
  revalidatePath("/order");
  revalidatePath("/weekly");
}

// 전체 잠금해제 토글 — ON이면 OFF할 때까지 모든 지점이 미수 있어도 일반/주간발주 가능(예약은 원래 미수잠금 없음).
export async function setOrderLockOverrideAction(formData: FormData) {
  await requireAdmin();
  const on = formData.get("on") === "true";
  await setOrderLockOverride(on);
  revalidatePath("/admin/deposits");
  revalidatePath("/order");
  revalidatePath("/weekly");
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
