"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMerchant, requireAdmin } from "@/lib/session";
import { maybeCompleteOnboarding } from "@/lib/onboarding";
import { sendPushToUser, sendPushToRole } from "@/lib/push";
import { writeAudit } from "@/lib/audit";
import { logError } from "@/lib/log";

export type OnboardingActionState = { ok?: boolean; error?: string };

// 완료 순간(100%) 알림 — 점주에겐 '발주 오픈', 관리자에겐 완료 보고.
async function announceCompletionIfJust(userId: string) {
  const just = await maybeCompleteOnboarding(userId);
  if (!just) return;
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeName: true },
  });
  try {
    await sendPushToUser(userId, {
      title: "오픈 준비가 모두 끝났어요! 🎉",
      body: "이제 발주를 시작할 수 있어요.",
      url: "/order",
      type: "system",
    });
    await sendPushToRole("ADMIN_SAEROP", {
      title: "튜토리얼 완료",
      body: `${u?.storeName ?? "가맹점"} 오픈 준비 100% 완료 — 발주가 열렸어요.`,
      url: "/admin/onboarding",
      type: "system",
    });
  } catch (e) {
    logError("onboarding.announceCompletion", e, { userId });
  }
}

// [점주] 자신의 단계 '완료' 토글.
export async function setMerchantStepDoneAction(input: {
  stepId: string;
  done: boolean;
}): Promise<OnboardingActionState> {
  const user = await requireMerchant();
  if (user.onboardingStartedAt == null) {
    return { error: "튜토리얼 대상이 아니에요." };
  }
  const stepId = String(input.stepId ?? "");
  const step = await prisma.onboardingStep.findUnique({ where: { id: stepId } });
  if (!step || !step.active) return { error: "단계를 찾을 수 없어요." };

  const at = input.done ? new Date() : null;
  await prisma.onboardingItem.upsert({
    where: { userId_stepId: { userId: user.id, stepId } },
    create: { userId: user.id, stepId, merchantDoneAt: at },
    update: { merchantDoneAt: at },
  });
  await announceCompletionIfJust(user.id);
  revalidatePath("/onboarding");
  revalidatePath(`/onboarding/${stepId}`);
  return { ok: true };
}

// [관리자] 특정 점주의 단계 '확인' 토글(이중 확인의 본사 측).
export async function adminSetStepDoneAction(input: {
  userId: string;
  stepId: string;
  done: boolean;
}): Promise<OnboardingActionState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const stepId = String(input.stepId ?? "");
  const [target, step] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, storeName: true },
    }),
    prisma.onboardingStep.findUnique({ where: { id: stepId } }),
  ]);
  if (!target || target.role !== "MERCHANT_HOTDEAL") {
    return { error: "대상 점포가 아니에요." };
  }
  if (!step) return { error: "단계를 찾을 수 없어요." };

  const at = input.done ? new Date() : null;
  await prisma.onboardingItem.upsert({
    where: { userId_stepId: { userId, stepId } },
    create: { userId, stepId, adminDoneAt: at, adminBy: at ? admin.storeName : null },
    update: { adminDoneAt: at, adminBy: at ? admin.storeName : null },
  });
  await writeAudit({
    action: "onboarding.adminConfirm",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "User",
    targetId: userId,
    summary: `${target.storeName} · '${step.title}' 본사 확인 ${input.done ? "ON" : "해제"}`,
  });
  // 완료 알림 or 개별 확인 알림
  const beforeCompletion = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true },
  });
  await announceCompletionIfJust(userId);
  const afterCompletion = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingCompletedAt: true },
  });
  // 방금 완료된 게 아니면(개별 확인) 점주에게 확인 알림
  if (
    input.done &&
    beforeCompletion?.onboardingCompletedAt == null &&
    afterCompletion?.onboardingCompletedAt == null
  ) {
    try {
      await sendPushToUser(userId, {
        title: "오픈 준비 단계가 확인됐어요",
        body: `'${step.title}' 본사 확인 완료.`,
        url: "/onboarding",
        type: "system",
      });
    } catch (e) {
      logError("onboarding.notifyConfirm", e, { userId });
    }
  }
  revalidatePath("/admin/onboarding");
  revalidatePath(`/admin/onboarding/${userId}`);
  return { ok: true };
}

// [관리자] 체크리스트 단계 저장(제목·본문·담당·필수). id 있으면 수정, 없으면 신규(맨 끝).
export async function adminSaveStepAction(input: {
  id?: string;
  title: string;
  body: string;
  actor?: string;
  required?: boolean;
}): Promise<OnboardingActionState> {
  const admin = await requireAdmin();
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (!title) return { error: "제목을 입력하세요." };
  const body = String(input.body ?? "").slice(0, 5000);
  const actor = ["MERCHANT", "ADMIN", "BOTH"].includes(input.actor ?? "")
    ? (input.actor as string)
    : "BOTH";
  const required = input.required !== false;

  if (input.id) {
    await prisma.onboardingStep.update({
      where: { id: input.id },
      data: { title, body, actor, required },
    });
  } else {
    const last = await prisma.onboardingStep.findFirst({
      orderBy: { order: "desc" },
      select: { order: true },
    });
    await prisma.onboardingStep.create({
      data: { title, body, actor, required, order: (last?.order ?? 0) + 1 },
    });
  }
  await writeAudit({
    action: "onboarding.editStep",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "OnboardingStep",
    targetId: input.id ?? "new",
    summary: `체크리스트 단계 ${input.id ? "수정" : "추가"}: ${title}`,
  });
  revalidatePath("/admin/onboarding/template");
  revalidatePath("/onboarding");
  return { ok: true };
}

// [관리자] 단계 소프트 삭제(active=false). 진행 상태(OnboardingItem)는 남지만 뷰에서 제외.
export async function adminDeleteStepAction(input: {
  id: string;
}): Promise<OnboardingActionState> {
  const admin = await requireAdmin();
  if (!input.id) return { error: "잘못된 요청이에요." };
  await prisma.onboardingStep.update({
    where: { id: input.id },
    data: { active: false },
  });
  await writeAudit({
    action: "onboarding.deleteStep",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "OnboardingStep",
    targetId: input.id,
    summary: "체크리스트 단계 삭제(숨김)",
  });
  revalidatePath("/admin/onboarding/template");
  revalidatePath("/onboarding");
  return { ok: true };
}

// [관리자] 한 점포의 온보딩 시작(수동). 승인된 핫딜마켓만. 시작하면 발주가 100%까지 잠긴다.
export async function startOnboardingAction(input: {
  userId: string;
}): Promise<OnboardingActionState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      storeName: true,
      onboardingStartedAt: true,
      onboardingCompletedAt: true,
    },
  });
  if (!u || u.role !== "MERCHANT_HOTDEAL" || u.status !== "APPROVED") {
    return { error: "승인된 핫딜마켓 가맹점만 튜토리얼을 시작할 수 있어요." };
  }
  if (u.onboardingStartedAt != null) return { error: "이미 튜토리얼 진행 중이에요." };
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStartedAt: new Date(), onboardingCompletedAt: null },
  });
  await writeAudit({
    action: "onboarding.start",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "User",
    targetId: userId,
    summary: `${u.storeName} 튜토리얼 시작(발주 잠금)`,
  });
  try {
    await sendPushToUser(userId, {
      title: "오픈 준비 체크리스트가 열렸어요",
      body: "오픈 전 준비 사항을 하나씩 완료해 주세요.",
      url: "/onboarding",
      type: "system",
    });
  } catch (e) {
    logError("onboarding.notifyStart", e, { userId });
  }
  revalidatePath("/admin/onboarding");
  return { ok: true };
}

// [관리자] 온보딩(튜토리얼) 취소 — 잘못 시작했을 때 되돌린다. 발주 잠금 해제(발주 오픈).
// 단계 진행상태(OnboardingItem)는 지우지 않고 남겨둔다(다시 시작하면 이어짐).
export async function cancelOnboardingAction(input: {
  userId: string;
}): Promise<OnboardingActionState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, storeName: true, onboardingStartedAt: true },
  });
  if (!u || u.role !== "MERCHANT_HOTDEAL") return { error: "대상 점포가 아니에요." };
  if (u.onboardingStartedAt == null) {
    return { error: "진행 중인 튜토리얼이 없어요." };
  }
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStartedAt: null, onboardingCompletedAt: null },
  });
  await writeAudit({
    action: "onboarding.cancel",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "User",
    targetId: userId,
    summary: `${u.storeName} 튜토리얼 취소(발주 잠금 해제)`,
  });
  try {
    await sendPushToUser(userId, {
      title: "발주가 열렸어요",
      body: "오픈 준비 단계가 해제되어 바로 발주할 수 있어요.",
      url: "/order",
      type: "system",
    });
  } catch (e) {
    logError("onboarding.notifyCancel", e, { userId });
  }
  revalidatePath("/admin/onboarding");
  revalidatePath(`/admin/onboarding/${userId}`);
  return { ok: true };
}
