"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { runLocalSourcing, runMealkitSourcing } from "@/lib/sourcing/engine";
import { logError } from "@/lib/log";

export type SourcingState = { ok?: boolean; error?: string; msg?: string };

const LEAD_STATUS = ["NEW", "CONTACTED", "REJECTED", "DEAL", "IGNORED"];
const PRODUCT_STATUS = ["NEW", "PICKED", "IGNORED"];
const norm = (s: string) => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, "");

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

// [관리자] 수동 추가 — 크롤 없이 직접 후보 등록(어댑터 키 없어도 바로 사용).
export async function addManualLeadAction(input: {
  name: string; region?: string; category?: string; phone?: string; url?: string; note?: string;
}): Promise<SourcingState> {
  await requireAdmin();
  const name = String(input.name ?? "").trim();
  if (!name) return { error: "상호를 입력하세요." };
  const key = "L:" + norm(name);
  await prisma.sourcingLead.upsert({
    where: { key },
    create: {
      key, source: "manual", name, region: input.region?.trim() || "", category: input.category?.trim() || "",
      phone: input.phone?.trim() || "", url: input.url?.trim() || "", note: input.note?.trim() || "", trendScore: 50,
    },
    update: {
      region: input.region?.trim() || undefined, category: input.category?.trim() || undefined,
      phone: input.phone?.trim() || undefined, url: input.url?.trim() || undefined,
      note: input.note?.trim() || undefined, lastSeenAt: new Date(),
    },
  });
  revalidatePath("/admin/sourcing");
  return { ok: true };
}

export async function addManualProductAction(input: {
  name: string; brand?: string; price?: string; url?: string; note?: string;
}): Promise<SourcingState> {
  await requireAdmin();
  const name = String(input.name ?? "").trim();
  if (!name) return { error: "제품명을 입력하세요." };
  const brand = input.brand?.trim() || "";
  const key = "P:" + norm(brand) + ":" + norm(name);
  const price = input.price ? parseInt(String(input.price).replace(/[^0-9]/g, ""), 10) : null;
  await prisma.sourcingProduct.upsert({
    where: { key },
    create: {
      key, source: "manual", name, brand, price: Number.isFinite(price as number) ? price : null,
      url: input.url?.trim() || "", note: input.note?.trim() || "", demandScore: 50,
    },
    update: {
      brand: brand || undefined, price: Number.isFinite(price as number) ? price : undefined,
      url: input.url?.trim() || undefined, note: input.note?.trim() || undefined, lastSeenAt: new Date(),
    },
  });
  revalidatePath("/admin/sourcing");
  return { ok: true };
}

// [관리자] 지금 수집 — 엔진 직접 실행(크롤 어댑터 켜져 있으면 수집, 없으면 0). 시간이 걸릴 수 있음.
export async function runSourcingNowAction(input: { track: "local" | "mealkit" }): Promise<SourcingState> {
  await requireAdmin();
  try {
    const r = input.track === "mealkit" ? await runMealkitSourcing() : await runLocalSourcing();
    revalidatePath("/admin/sourcing");
    return { ok: true, msg: `수집 ${r.found} · 저장 ${r.kept}` };
  } catch (e) {
    logError("sourcing.runNow", e, { track: input.track });
    return { error: "수집 중 오류가 났어요. (어댑터 키·네트워크 확인)" };
  }
}
