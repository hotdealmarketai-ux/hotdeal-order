"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { ASSIGNABLE_MERCHANT_ROLES, type Role } from "@/lib/constants";

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
