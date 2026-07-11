"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { notifyMerchantWeeklyInvoiceIssued } from "@/lib/push";
import { writeAudit } from "@/lib/audit";

export type WeeklyInvoiceState = { error?: string };

type RawItem = { group?: string; name?: string; qty?: string; unitPrice?: string };

type CleanItem = {
  category: string;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

// 금액은 서버에서만 계산(클라 값 신뢰 안 함). 수량/단가 엄격 파싱(daily와 동일 규칙).
function cleanWeekly(raw: RawItem[]): CleanItem[] | { error: string } {
  const out: CleanItem[] = [];
  for (const r of raw.slice(0, 300)) {
    const name = String(r.name ?? "").trim().slice(0, 100);
    const qtyRaw = String(r.qty ?? "").trim();
    const priceRaw = String(r.unitPrice ?? "").trim();
    if (!name && !qtyRaw && !priceRaw) continue;
    if (!name) return { error: "품목명이 비어 있는 줄이 있어요." };
    const qty = parseQtyStrict(qtyRaw);
    if (qty == null) {
      return { error: `'${name}' 수량을 확인해 주세요. (숫자만)` };
    }
    const unitPrice = parsePriceStrict(priceRaw);
    if (unitPrice == null) {
      return { error: `'${name}' 단가를 확인해 주세요. (원 단위 숫자만)` };
    }
    out.push({
      category: String(r.group ?? "WEEKLY").slice(0, 10),
      name,
      qty,
      unitPrice,
      amount: Math.round(qty * unitPrice),
    });
  }
  return out;
}

// 주간발주 입금요청서 발행 — 점주 주간발주를 프리로드해 관리자가 확인·수정 후 발행.
export async function saveWeeklyInvoiceAction(
  _prev: WeeklyInvoiceState,
  formData: FormData,
): Promise<WeeklyInvoiceState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const date = String(formData.get("date") ?? ""); // weekKey(그 주 토요일)
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "잘못된 요청이에요." };
  }
  const merchant = await prisma.user.findUnique({ where: { id: userId } });
  if (!merchant || !isMerchant(merchant.role as Role)) {
    return { error: "점포를 찾을 수 없어요." };
  }

  let raw: RawItem[] = [];
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    raw = [];
  }
  const items = cleanWeekly(Array.isArray(raw) ? raw : []);
  if ("error" in items) return items;
  if (items.length === 0) return { error: "품목을 한 개 이상 입력하세요." };

  const dupe = await prisma.invoice.findFirst({
    where: { userId, date, kind: "WEEKLY", status: { not: "VOID" } },
    select: { id: true },
  });
  if (dupe) {
    return { error: "이 주간발주 입금요청서가 이미 있어요." };
  }

  const total = items.reduce((n, it) => n + it.amount, 0);
  let id = "";
  try {
    const created = await prisma.invoice.create({
      data: {
        userId,
        date,
        kind: "WEEKLY",
        status: "ISSUED",
        total,
        issuedAt: new Date(),
        items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) },
      },
    });
    id = created.id;
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { error: "이 주간발주 입금요청서가 이미 있어요." };
    }
    console.error("[weekly-invoice] save failed:", err);
    return { error: "발행에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  await writeAudit({
    action: "weeklyInvoice.issue",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: id,
    summary: `주간발주 입금요청서 발행 · ${date} · ${total.toLocaleString("ko-KR")}원`,
  });
  await notifyMerchantWeeklyInvoiceIssued(userId);
  revalidatePath("/admin/weekly");
  revalidatePath(`/admin/weekly/${userId}`);
  redirect(`/admin/weekly/${userId}?issued=1`);
}

// 주간발주 잠금 해제/재잠금 — 1회성(그 주간 사이클만). 미납이어도 이번 주간발주 허용.
export async function setWeeklyOrderUnlockAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const unlock = formData.get("unlock") === "true";
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: {
      weeklyOrderUnlock: unlock,
      weeklyOrderUnlockAt: unlock ? new Date() : null,
    },
  });
  revalidatePath(`/admin/weekly/${userId}`);
  revalidatePath("/admin/weekly");
  revalidatePath("/weekly");
}
