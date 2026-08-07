"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMerchant, requireAdmin } from "@/lib/session";
import { maybeCompleteOnboarding, countLeaves, isLeafNode } from "@/lib/onboarding";
import { saveOnboardingImage } from "@/lib/storage";
import { sendPushToUser, sendPushToRole } from "@/lib/push";
import { writeAudit } from "@/lib/audit";
import { logError } from "@/lib/log";

export type OnbState = { ok?: boolean; error?: string };

function revalidateTemplate() {
  revalidatePath("/admin/onboarding");
  revalidatePath("/admin/onboarding/template");
  revalidatePath("/onboarding");
}

// 완료 순간(100%) 알림 — 점주 발주 오픈 + 관리자 보고.
async function announceCompletionIfJust(userId: string) {
  const just = await maybeCompleteOnboarding(userId);
  if (!just) return;
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { storeName: true } });
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

// 템플릿이 바뀌면(분류 삭제 등) 진행 중 점포 완료 재판정(멱등).
async function reevaluateInProgress() {
  const users = await prisma.user.findMany({
    where: {
      role: "MERCHANT_HOTDEAL",
      status: "APPROVED",
      onboardingStartedAt: { not: null },
      onboardingCompletedAt: null,
    },
    select: { id: true },
  });
  for (const u of users) await announceCompletionIfJust(u.id);
}

// ── 분류(노드) 편집 ───────────────────────────────────────────
// [관리자] 분류 추가. parentId=null 이면 대분류. 소분류(3단계)까지.
export async function addNodeAction(input: {
  parentId?: string | null;
  title?: string;
}): Promise<OnbState> {
  await requireAdmin();
  const parentId = input.parentId ? String(input.parentId) : null;
  const title = String(input.title ?? "").trim().slice(0, 200);
  if (parentId) {
    const parent = await prisma.onboardingNode.findUnique({ where: { id: parentId }, select: { id: true } });
    if (!parent) return { error: "상위 분류를 찾을 수 없어요." };
    // 깊이 계산
    let depth = 1;
    let cur = parent.id as string | null;
    let g = 0;
    while (cur && g++ < 10) {
      const p = await prisma.onboardingNode.findUnique({ where: { id: cur }, select: { parentId: true } });
      cur = p?.parentId ?? null;
      if (cur) depth++;
    }
    if (depth >= 3) return { error: "소분류까지만 만들 수 있어요." };
  }
  const last = await prisma.onboardingNode.findFirst({
    where: { parentId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  await prisma.onboardingNode.create({ data: { parentId, title, order: (last?.order ?? -1) + 1 } });
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 제목/설명 수정.
export async function updateNodeAction(input: {
  id: string;
  title?: string;
  description?: string;
}): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  const data: { title?: string; description?: string } = {};
  if (typeof input.title === "string") data.title = input.title.slice(0, 200);
  if (typeof input.description === "string") data.description = input.description.slice(0, 5000);
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.onboardingNode.updateMany({ where: { id }, data });
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 설명 이미지 추가(붙여넣기/업로드). FormData: nodeId + file.
export async function uploadNodeImageAction(formData: FormData): Promise<OnbState & { url?: string }> {
  await requireAdmin();
  const id = String(formData.get("nodeId") ?? "");
  const file = formData.get("file");
  if (!id) return { error: "잘못된 요청이에요." };
  if (!(file instanceof File)) return { error: "이미지를 찾을 수 없어요." };
  const node = await prisma.onboardingNode.findUnique({ where: { id }, select: { images: true } });
  if (!node) return { error: "분류를 찾을 수 없어요." };
  const url = await saveOnboardingImage(file);
  if (!url) return { error: "이미지 저장에 실패했어요. (이미지 파일, 10MB 이하)" };
  await prisma.onboardingNode.update({ where: { id }, data: { images: [...node.images, url] } });
  revalidateTemplate();
  return { ok: true, url };
}

// [관리자] 분류 설명 이미지 제거.
export async function removeNodeImageAction(input: { id: string; url: string }): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  const url = String(input.url ?? "");
  if (!id || !url) return { error: "잘못된 요청이에요." };
  const node = await prisma.onboardingNode.findUnique({ where: { id }, select: { images: true } });
  if (!node) return { ok: true };
  await prisma.onboardingNode.update({
    where: { id },
    data: { images: node.images.filter((u) => u !== url) },
  });
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 삭제(하위 분류·승인 모두 cascade).
export async function deleteNodeAction(input: { id: string }): Promise<OnbState> {
  const admin = await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  const node = await prisma.onboardingNode.findUnique({ where: { id }, select: { title: true } });
  await prisma.onboardingNode.deleteMany({ where: { id } });
  await writeAudit({
    action: "onboarding.deleteNode",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "OnboardingNode",
    targetId: id,
    summary: `분류 삭제: ${node?.title || "(제목 없음)"}`,
  });
  await reevaluateInProgress(); // 삭제로 남은 항목이 전부 완료되면 발주 오픈
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 순서 이동.
export async function moveNodeAction(input: { id: string; dir: "up" | "down" }): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  const node = await prisma.onboardingNode.findUnique({
    where: { id },
    select: { id: true, parentId: true, order: true },
  });
  if (!node) return { error: "분류를 찾을 수 없어요." };
  const neighbor = await prisma.onboardingNode.findFirst({
    where:
      input.dir === "up"
        ? { parentId: node.parentId, order: { lt: node.order } }
        : { parentId: node.parentId, order: { gt: node.order } },
    orderBy: { order: input.dir === "up" ? "desc" : "asc" },
    select: { id: true, order: true },
  });
  if (!neighbor) return { ok: true };
  await prisma.$transaction([
    prisma.onboardingNode.update({ where: { id: node.id }, data: { order: neighbor.order } }),
    prisma.onboardingNode.update({ where: { id: neighbor.id }, data: { order: node.order } }),
  ]);
  revalidateTemplate();
  return { ok: true };
}

// ── 체크(승인제) ──────────────────────────────────────────────
// [점주] 최하위 분류 체크 요청 토글. 승인 전까지 '승인 대기'.
export async function merchantToggleCheckAction(input: {
  nodeId: string;
  on: boolean;
}): Promise<OnbState> {
  const user = await requireMerchant();
  if (user.onboardingStartedAt == null) return { error: "튜토리얼 대상이 아니에요." };
  const nodeId = String(input.nodeId ?? "");
  if (!(await isLeafNode(nodeId))) return { error: "하위 항목이 있는 분류는 직접 체크할 수 없어요." };

  const existing = await prisma.onboardingApproval.findUnique({
    where: { userId_nodeId: { userId: user.id, nodeId } },
    select: { approvedAt: true },
  });
  if (input.on) {
    if (existing) return { ok: true }; // 이미 요청/승인됨
    await prisma.onboardingApproval.create({ data: { userId: user.id, nodeId } });
    try {
      const node = await prisma.onboardingNode.findUnique({ where: { id: nodeId }, select: { title: true } });
      await sendPushToRole("ADMIN_SAEROP", {
        title: "승인 요청",
        body: `${user.storeName} · '${node?.title ?? "항목"}' 체크 승인 요청`,
        url: `/admin/onboarding/${user.id}`,
        type: "system",
      });
    } catch (e) {
      logError("onboarding.notifyRequest", e, { userId: user.id });
    }
  } else {
    if (existing?.approvedAt) return { error: "승인된 항목은 본사만 해제할 수 있어요." };
    await prisma.onboardingApproval.deleteMany({ where: { userId: user.id, nodeId } });
  }
  revalidatePath("/onboarding");
  return { ok: true };
}

// [관리자] 특정 점포의 최하위 항목 승인/해제.
export async function adminApproveAction(input: {
  userId: string;
  nodeId: string;
  approve: boolean;
}): Promise<OnbState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const nodeId = String(input.nodeId ?? "");
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!target || target.role !== "MERCHANT_HOTDEAL") return { error: "대상 점포가 아니에요." };
  if (!(await isLeafNode(nodeId))) return { error: "하위 항목이 있는 분류는 승인 대상이 아니에요." };

  if (input.approve) {
    await prisma.onboardingApproval.upsert({
      where: { userId_nodeId: { userId, nodeId } },
      create: { userId, nodeId, approvedAt: new Date(), approvedBy: admin.storeName },
      update: { approvedAt: new Date(), approvedBy: admin.storeName },
    });
  } else {
    // 승인 해제 — 요청 기록은 남기고 승인만 취소
    await prisma.onboardingApproval.updateMany({
      where: { userId, nodeId },
      data: { approvedAt: null, approvedBy: "" },
    });
  }
  const before = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingCompletedAt: true } });
  await announceCompletionIfJust(userId);
  const after = await prisma.user.findUnique({ where: { id: userId }, select: { onboardingCompletedAt: true } });
  // 방금 완료가 아니면 개별 승인 알림
  if (input.approve && before?.onboardingCompletedAt == null && after?.onboardingCompletedAt == null) {
    try {
      const node = await prisma.onboardingNode.findUnique({ where: { id: nodeId }, select: { title: true } });
      await sendPushToUser(userId, {
        title: "항목이 승인됐어요",
        body: `'${node?.title ?? "항목"}' 본사 승인 완료.`,
        url: "/onboarding",
        type: "system",
      });
    } catch (e) {
      logError("onboarding.notifyApprove", e, { userId });
    }
  }
  revalidatePath(`/admin/onboarding/${userId}`);
  return { ok: true };
}

// ── 시작 / 취소 ───────────────────────────────────────────────
// [관리자] 튜토리얼 시작(신규/재시작). 진행 중이 아니면 언제든. 시작 시 그 지점 체크 초기화.
export async function startOnboardingAction(input: { userId: string }): Promise<OnbState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, storeName: true, onboardingStartedAt: true, onboardingCompletedAt: true },
  });
  if (!u || u.role !== "MERCHANT_HOTDEAL" || u.status !== "APPROVED") {
    return { error: "승인된 핫딜마켓 가맹점만 튜토리얼을 시작할 수 있어요." };
  }
  // 진행 중(시작됨 & 미완료)이면 중복 시작 금지. 완료 지점은 다시 시작 가능.
  if (u.onboardingStartedAt != null && u.onboardingCompletedAt == null) {
    return { error: "이미 튜토리얼 진행 중이에요." };
  }
  if ((await countLeaves()) === 0) return { error: "먼저 체크 항목이 있는 템플릿을 만들어 주세요." };

  await prisma.onboardingApproval.deleteMany({ where: { userId } }); // 재시작 = 처음부터
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

// [관리자] 튜토리얼 취소 — 발주 잠금 해제.
export async function cancelOnboardingAction(input: { userId: string }): Promise<OnbState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, storeName: true, onboardingStartedAt: true },
  });
  if (!u || u.role !== "MERCHANT_HOTDEAL") return { error: "대상 점포가 아니에요." };
  if (u.onboardingStartedAt == null) return { error: "진행 중인 튜토리얼이 없어요." };
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
