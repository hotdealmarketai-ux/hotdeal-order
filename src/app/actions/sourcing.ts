"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";

export type SourcingState = { ok?: boolean; error?: string; msg?: string };

// 로컬·밀키트 동일 상태 흐름(둘 다 직접 컨택하므로). 수집은 전부 아침 크론 자동.
const LEAD_STATUS = ["NEW", "CONTACTED", "REJECTED", "DEAL", "IGNORED"];
const PRODUCT_STATUS = LEAD_STATUS;

// [관리자] 로컬 후보 상태 변경.
export async function setLeadStatusAction(input: { id: string; status: string }): Promise<SourcingState> {
  await requireAdmin();
  if (!LEAD_STATUS.includes(input.status)) return { error: "잘못된 상태예요." };
  await prisma.sourcingLead.updateMany({ where: { id: String(input.id) }, data: { status: input.status } });
  revalidatePath("/admin/sourcing");
  return { ok: true };
}

// [관리자] 밀키트 후보 상태 변경.
export async function setProductStatusAction(input: { id: string; status: string }): Promise<SourcingState> {
  await requireAdmin();
  if (!PRODUCT_STATUS.includes(input.status)) return { error: "잘못된 상태예요." };
  await prisma.sourcingProduct.updateMany({ where: { id: String(input.id) }, data: { status: input.status } });
  revalidatePath("/admin/sourcing");
  return { ok: true };
}

export async function deleteLeadAction(input: { id: string }): Promise<SourcingState> {
  await requireAdmin();
  await prisma.sourcingLead.deleteMany({ where: { id: String(input.id) } });
  revalidatePath("/admin/sourcing");
  return { ok: true };
}
export async function deleteProductAction(input: { id: string }): Promise<SourcingState> {
  await requireAdmin();
  await prisma.sourcingProduct.deleteMany({ where: { id: String(input.id) } });
  revalidatePath("/admin/sourcing");
  return { ok: true };
}
