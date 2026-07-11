"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { notifyMerchantWeeklyInvoiceIssued } from "@/lib/push";
import { writeAudit } from "@/lib/audit";
import { setWeeklyForceOpen } from "@/lib/weekly";
import { WEEKLY_BY_SEQ } from "@/lib/weekly-catalog";

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

export type WeeklyPriceState = { ok?: boolean; error?: string; saved?: number };

// 주간발주 카탈로그 단가 저장 — 기본값과 다르면 오버라이드 upsert, 같으면 오버라이드 삭제.
export async function saveWeeklyPricesAction(
  _prev: WeeklyPriceState,
  formData: FormData,
): Promise<WeeklyPriceState> {
  await requireAdmin();
  let payload: { code?: string; boxPrice?: string | number }[] = [];
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    payload = [];
  }
  const ops = [];
  for (const p of Array.isArray(payload) ? payload : []) {
    const item = WEEKLY_BY_SEQ[String(p.code ?? "")];
    if (!item) continue;
    const price = Math.floor(Number(String(p.boxPrice ?? "").replace(/[^0-9]/g, "")));
    if (!Number.isFinite(price) || price < 0) continue;
    if (price === item.boxPrice) {
      ops.push(prisma.weeklyPrice.deleteMany({ where: { code: item.seq } }));
    } else {
      ops.push(
        prisma.weeklyPrice.upsert({
          where: { code: item.seq },
          create: { code: item.seq, boxPrice: price },
          update: { boxPrice: price },
        }),
      );
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);
  revalidatePath("/admin/weekly/prices");
  revalidatePath("/weekly");
  return { ok: true, saved: ops.length };
}

// 관리자 전역 강제 오픈 토글 — 토요일 12~20시가 아니어도 주간발주를 열 수 있음(테스트/특례).
export async function setWeeklyForceOpenAction(formData: FormData) {
  const admin = await requireAdmin();
  const on = formData.get("on") === "true";
  await setWeeklyForceOpen(on);
  await writeAudit({
    action: "weekly.forceOpen",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "weekly",
    targetId: "global",
    summary: `주간발주 강제 오픈 ${on ? "ON" : "OFF"}`,
  });
  revalidatePath("/admin/weekly");
  revalidatePath("/weekly");
}

// 주간발주 입금요청서 취소(VOID) — 잘못 발행 시. 발행(ISSUED) 상태만.
export async function voidWeeklyInvoiceAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id || String(formData.get("confirm") ?? "") !== "VOID-WEEKLY") return;
  const upd = await prisma.invoice.updateMany({
    where: { id, kind: "WEEKLY", status: "ISSUED" },
    data: { status: "VOID", voidedAt: new Date() },
  });
  if (upd.count === 0) return;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { userId: true, date: true, total: true },
  });
  await writeAudit({
    action: "weeklyInvoice.void",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: id,
    summary: `주간발주 입금요청서 취소 · ${inv?.date ?? ""} · ${(inv?.total ?? 0).toLocaleString("ko-KR")}원`,
  });
  revalidatePath("/admin/weekly");
  if (inv) revalidatePath(`/admin/weekly/${inv.userId}`);
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
