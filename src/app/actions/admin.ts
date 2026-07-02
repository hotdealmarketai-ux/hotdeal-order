"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import {
  ALL_ROLES,
  ASSIGNABLE_MERCHANT_ROLES,
  type Role,
  type Status,
} from "@/lib/constants";

const EDITABLE_STATUSES: Status[] = ["APPROVED", "SUSPENDED", "PENDING", "REJECTED"];

export type MemberFormState = { ok?: boolean; error?: string };

// 회원 개인정보 + 역할 + 승인상태 수정
export async function updateMemberAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "잘못된 요청이에요." };

  const storeName = String(formData.get("storeName") ?? "").trim().slice(0, 100);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const address = String(formData.get("address") ?? "").trim().slice(0, 200);
  let role = String(formData.get("role") ?? "") as Role;
  let status = String(formData.get("status") ?? "") as Status;

  // 입금자명 — 콤마/줄바꿈으로 여러 개, 중복·공백 정리
  const payerNames = [
    ...new Set(
      String(formData.get("payerNames") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 60)),
    ),
  ].slice(0, 20);

  if (!ALL_ROLES.includes(role)) return { error: "올바르지 않은 역할이에요." };
  if (!EDITABLE_STATUSES.includes(status)) return { error: "올바르지 않은 상태예요." };
  if (!storeName) return { error: "상호명을 입력하세요." };

  // 본인(관리자) 계정은 역할/상태를 낮춰 스스로 잠그지 못하게 보호
  if (userId === admin.id) {
    role = "ADMIN_SAEROP";
    status = "APPROVED";
  }

  await prisma.user.update({
    where: { id: userId },
    data: { storeName, phone, address, role, status, payerNames },
  });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
  return { ok: true };
}

// 정지/복구 토글
export async function setMemberStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") as Status;
  if (!userId || !EDITABLE_STATUSES.includes(status)) return;
  if (userId === admin.id) return; // 본인 정지 금지
  await prisma.user.update({ where: { id: userId }, data: { status } });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
}

// 회원 삭제 — 본인 제외. 발주 이력(+항목)도 함께 삭제(되돌릴 수 없음).
export async function deleteMemberAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === admin.id) return; // 본인 삭제 금지
  await prisma.$transaction([
    prisma.order.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  revalidatePath("/admin/members");
  redirect("/admin/members");
}

// 비밀번호 초기화(관리자가 새 비번 지정)
export async function resetMemberPasswordAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const pw = String(formData.get("password") ?? "");
  if (!userId) return { error: "잘못된 요청이에요." };
  if (pw.length < 4) return { error: "비밀번호는 4자 이상으로 정해주세요." };
  const passwordHash = await bcrypt.hash(pw, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  revalidatePath(`/admin/members/${userId}`);
  return { ok: true };
}

export async function approveUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!userId || !ASSIGNABLE_MERCHANT_ROLES.includes(role)) return;
  await prisma.user.update({
    where: { id: userId },
    data: { role, status: "APPROVED" },
  });
  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
}

export async function rejectUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { status: "REJECTED" },
  });
  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
}

export async function addInventoryAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const status = String(formData.get("status") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
  await prisma.inventoryItem.create({
    data: { name, status, memo, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function updateInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const status = String(formData.get("status") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim();
  await prisma.inventoryItem.update({ where: { id }, data: { status, memo } });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function deleteInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.inventoryItem.delete({ where: { id } });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

// 전체 발주 초기화 — 관리자 전용. 모든 Order 삭제(OrderItem은 Cascade).
// 회원·재고는 유지. 실수 방지를 위해 확인 토큰 필요.
export async function resetAllOrdersAction(formData: FormData) {
  await requireAdmin();
  if (String(formData.get("confirm") ?? "") !== "RESET-ALL-ORDERS") return;
  const res = await prisma.order.deleteMany({});
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/hotdeal");
  redirect(`/admin/orders?reset=${res.count}`);
}
