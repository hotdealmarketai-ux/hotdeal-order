"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireMerchant, requireAdmin } from "@/lib/session";
import { maybeCompleteOnboarding, getBreadcrumb, BLOCK_TYPES } from "@/lib/onboarding";
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

// 템플릿이 축소되면(체크박스 삭제 등) 진행 중 점포들이 100%에 도달할 수 있으므로 완료를 재판정.
// maybeCompleteOnboarding은 멱등(완료/미완료 모두 안전)이라 미완료 점포엔 부작용 없음.
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

// ── 분류(노드) ────────────────────────────────────────────────
// [관리자] 분류 추가. parentId=null 이면 대분류. 깊이는 소분류(3단계)까지.
export async function addNodeAction(input: {
  parentId?: string | null;
  title?: string;
}): Promise<OnbState> {
  await requireAdmin();
  const parentId = input.parentId ? String(input.parentId) : null;
  const title = String(input.title ?? "").trim().slice(0, 200);

  if (parentId) {
    const parent = await prisma.onboardingNode.findUnique({
      where: { id: parentId },
      select: { id: true },
    });
    if (!parent) return { error: "상위 분류를 찾을 수 없어요." };
    const depth = (await getBreadcrumb(parentId)).length; // 1=대,2=중,3=소
    if (depth >= 3) return { error: "소분류까지만 만들 수 있어요." };
  }
  const last = await prisma.onboardingNode.findFirst({
    where: { parentId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  await prisma.onboardingNode.create({
    data: { parentId, title, order: (last?.order ?? -1) + 1 },
  });
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 이름 변경.
export async function renameNodeAction(input: {
  id: string;
  title: string;
}): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  await prisma.onboardingNode.updateMany({
    where: { id },
    data: { title: String(input.title ?? "").slice(0, 200) },
  });
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 삭제(하위 분류·블록·체크 모두 함께 삭제=cascade).
export async function deleteNodeAction(input: { id: string }): Promise<OnbState> {
  const admin = await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  const node = await prisma.onboardingNode.findUnique({
    where: { id },
    select: { title: true },
  });
  await prisma.onboardingNode.deleteMany({ where: { id } }); // 하위 분류·블록·체크 cascade, 없으면 no-op
  await writeAudit({
    action: "onboarding.deleteNode",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "OnboardingNode",
    targetId: id,
    summary: `분류 삭제: ${node?.title || "(제목 없음)"}`,
  });
  // 하위 체크박스가 함께 삭제되면 진행 중 점포가 100%에 도달할 수 있음 → 완료 재판정.
  await reevaluateInProgress();
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 분류 순서 이동(형제와 order 교환).
export async function moveNodeAction(input: {
  id: string;
  dir: "up" | "down";
}): Promise<OnbState> {
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
  if (!neighbor) return { ok: true }; // 이미 끝
  await prisma.$transaction([
    prisma.onboardingNode.update({ where: { id: node.id }, data: { order: neighbor.order } }),
    prisma.onboardingNode.update({ where: { id: neighbor.id }, data: { order: node.order } }),
  ]);
  revalidateTemplate();
  return { ok: true };
}

// ── 블록(콘텐츠) ──────────────────────────────────────────────
// [관리자] 블록 추가. type: HEADING | TEXT | IMAGE | CHECK.
export async function addBlockAction(input: {
  nodeId: string;
  type: string;
}): Promise<OnbState> {
  await requireAdmin();
  const nodeId = String(input.nodeId ?? "");
  const type = BLOCK_TYPES.includes(input.type as (typeof BLOCK_TYPES)[number])
    ? input.type
    : "TEXT";
  const node = await prisma.onboardingNode.findUnique({
    where: { id: nodeId },
    select: { id: true },
  });
  if (!node) return { error: "분류를 찾을 수 없어요." };
  const last = await prisma.onboardingBlock.findFirst({
    where: { nodeId },
    orderBy: { order: "desc" },
    select: { order: true },
  });
  await prisma.onboardingBlock.create({
    data: { nodeId, type, order: (last?.order ?? -1) + 1, colSpan: 12 },
  });
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 블록 내용/폭 수정.
export async function updateBlockAction(input: {
  id: string;
  text?: string;
  colSpan?: number;
}): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  const data: { text?: string; colSpan?: number } = {};
  if (typeof input.text === "string") data.text = input.text.slice(0, 5000);
  if (typeof input.colSpan === "number") {
    data.colSpan = Math.min(12, Math.max(1, Math.round(input.colSpan)));
  }
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.onboardingBlock.updateMany({ where: { id }, data }); // 없으면 no-op(동시편집 안전)
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 블록 이미지 업로드(붙여넣기/파일). FormData: blockId + file.
export async function uploadBlockImageAction(
  formData: FormData,
): Promise<OnbState & { url?: string }> {
  await requireAdmin();
  const id = String(formData.get("blockId") ?? "");
  const file = formData.get("file");
  if (!id) return { error: "잘못된 요청이에요." };
  if (!(file instanceof File)) return { error: "이미지를 찾을 수 없어요." };
  const url = await saveOnboardingImage(file);
  if (!url) return { error: "이미지 저장에 실패했어요. (이미지 파일, 10MB 이하)" };
  await prisma.onboardingBlock.update({ where: { id }, data: { imageUrl: url } });
  revalidateTemplate();
  return { ok: true, url };
}

// [관리자] 블록 순서 이동.
export async function moveBlockAction(input: {
  id: string;
  dir: "up" | "down";
}): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  const block = await prisma.onboardingBlock.findUnique({
    where: { id },
    select: { id: true, nodeId: true, order: true },
  });
  if (!block) return { error: "블록을 찾을 수 없어요." };
  const neighbor = await prisma.onboardingBlock.findFirst({
    where:
      input.dir === "up"
        ? { nodeId: block.nodeId, order: { lt: block.order } }
        : { nodeId: block.nodeId, order: { gt: block.order } },
    orderBy: { order: input.dir === "up" ? "desc" : "asc" },
    select: { id: true, order: true },
  });
  if (!neighbor) return { ok: true };
  await prisma.$transaction([
    prisma.onboardingBlock.update({ where: { id: block.id }, data: { order: neighbor.order } }),
    prisma.onboardingBlock.update({ where: { id: neighbor.id }, data: { order: block.order } }),
  ]);
  revalidateTemplate();
  return { ok: true };
}

// [관리자] 블록 삭제(그 체크박스의 체크 기록도 cascade 삭제).
export async function deleteBlockAction(input: { id: string }): Promise<OnbState> {
  await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  await prisma.onboardingBlock.deleteMany({ where: { id } }); // 없으면 no-op(동시편집 안전)
  // 체크박스 삭제로 전체 수가 줄어 진행 중 점포가 100%에 도달할 수 있음 → 완료 재판정.
  await reevaluateInProgress();
  revalidateTemplate();
  return { ok: true };
}

// ── 체크박스 진행 ─────────────────────────────────────────────
// 내부: 체크 토글 후 완료 판정. checkedBy = 표시용 이름.
async function toggleCheck(userId: string, blockId: string, checked: boolean, by: string) {
  const block = await prisma.onboardingBlock.findUnique({
    where: { id: blockId },
    select: { id: true, type: true },
  });
  if (!block || block.type !== "CHECK") return { error: "체크 항목이 아니에요." };
  if (checked) {
    await prisma.onboardingCheck.upsert({
      where: { userId_blockId: { userId, blockId } },
      create: { userId, blockId, checkedBy: by.slice(0, 100) },
      update: { checkedBy: by.slice(0, 100) },
    });
  } else {
    await prisma.onboardingCheck.deleteMany({ where: { userId, blockId } });
  }
  await announceCompletionIfJust(userId);
  return { ok: true as const };
}

// [점주] 자기 체크박스 토글.
export async function merchantToggleCheckAction(input: {
  blockId: string;
  checked: boolean;
}): Promise<OnbState> {
  const user = await requireMerchant();
  if (user.onboardingStartedAt == null) return { error: "튜토리얼 대상이 아니에요." };
  const res = await toggleCheck(user.id, String(input.blockId ?? ""), !!input.checked, user.storeName);
  if (res.error) return res;
  revalidatePath("/onboarding");
  return { ok: true };
}

// [관리자] 특정 점포의 체크박스 토글(대신 확인/도움).
export async function adminToggleCheckAction(input: {
  userId: string;
  blockId: string;
  checked: boolean;
}): Promise<OnbState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target || target.role !== "MERCHANT_HOTDEAL") return { error: "대상 점포가 아니에요." };
  const res = await toggleCheck(userId, String(input.blockId ?? ""), !!input.checked, `본사·${admin.storeName}`);
  if (res.error) return res;
  revalidatePath(`/admin/onboarding/${userId}`);
  return { ok: true };
}

// ── 시작 / 취소 ───────────────────────────────────────────────
// [관리자] 한 점포의 튜토리얼 시작(수동). 승인된 핫딜마켓만. 시작하면 100%까지 발주 잠금.
export async function startOnboardingAction(input: { userId: string }): Promise<OnbState> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      role: true,
      status: true,
      storeName: true,
      onboardingStartedAt: true,
    },
  });
  if (!u || u.role !== "MERCHANT_HOTDEAL" || u.status !== "APPROVED") {
    return { error: "승인된 핫딜마켓 가맹점만 튜토리얼을 시작할 수 있어요." };
  }
  if (u.onboardingStartedAt != null) return { error: "이미 튜토리얼 진행 중이에요." };
  // 체크 항목이 하나도 없는 템플릿으로 시작하면 100%에 도달할 방법이 없어 발주가 잠긴다 → 차단.
  const nCheck = await prisma.onboardingBlock.count({ where: { type: "CHECK" } });
  if (nCheck === 0) return { error: "먼저 체크 항목이 있는 템플릿을 만들어 주세요." };
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingStartedAt: new Date(), onboardingCompletedAt: null },
  });
  // 취소→재시작 등으로 이미 전 항목이 체크돼 있으면 즉시 완료 처리(잠금 방지).
  const justCompleted = await maybeCompleteOnboarding(userId);
  await writeAudit({
    action: "onboarding.start",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "User",
    targetId: userId,
    summary: `${u.storeName} 튜토리얼 시작${justCompleted ? "(이미 완료 — 발주 오픈)" : "(발주 잠금)"}`,
  });
  try {
    await sendPushToUser(
      userId,
      justCompleted
        ? {
            title: "발주가 열렸어요",
            body: "오픈 준비가 이미 완료돼 바로 발주할 수 있어요.",
            url: "/order",
            type: "system",
          }
        : {
            title: "오픈 준비 체크리스트가 열렸어요",
            body: "오픈 전 준비 사항을 하나씩 완료해 주세요.",
            url: "/onboarding",
            type: "system",
          },
    );
  } catch (e) {
    logError("onboarding.notifyStart", e, { userId });
  }
  revalidatePath("/admin/onboarding");
  return { ok: true };
}

// [관리자] 튜토리얼 취소 — 발주 잠금 해제(발주 오픈). 체크 기록은 남겨둔다(다시 시작 시 이어짐).
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
