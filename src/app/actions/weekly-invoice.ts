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

export type WeeklyProductState = { ok?: boolean; error?: string };

type ProductRow = {
  code?: string | null;
  category?: string;
  name?: string;
  perBox?: string | number;
  supplyPrice?: string | number;
  deleted?: boolean;
};
const WEEKLY_CATS = new Set(["SNACK", "DAIRY", "DRIED", "EGG"]);
const toInt = (v: unknown, min: number) =>
  Math.max(min, Math.floor(Number(String(v ?? "").replace(/[^0-9]/g, "")) || 0));

// 주간발주 상품 저장 — 추가(신규)/수정/삭제(소프트, active=false)를 한 번에.
export async function saveWeeklyProductsAction(
  _prev: WeeklyProductState,
  formData: FormData,
): Promise<WeeklyProductState> {
  await requireAdmin();
  let rows: ProductRow[] = [];
  try {
    rows = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) rows = [];

  const maxAgg = await prisma.weeklyProduct.aggregate({ _max: { sortOrder: true } });
  let nextSort = (maxAgg._max.sortOrder ?? 0) + 1;

  const ops = [];
  for (const r of rows) {
    const code = r.code ? String(r.code) : null;
    if (r.deleted) {
      if (code) {
        ops.push(
          prisma.weeklyProduct.updateMany({ where: { code }, data: { active: false } }),
        );
      }
      continue;
    }
    const category = String(r.category ?? "");
    if (!WEEKLY_CATS.has(category)) continue;
    const name = String(r.name ?? "").trim().slice(0, 100);
    if (!name) continue; // 이름 없는 줄(빈 추가행)은 무시
    const perBox = Math.max(1, toInt(r.perBox, 1));
    const supplyPrice = toInt(r.supplyPrice, 0);
    if (code) {
      ops.push(
        prisma.weeklyProduct.updateMany({
          where: { code },
          data: { category, name, perBox, supplyPrice, active: true },
        }),
      );
    } else {
      ops.push(
        prisma.weeklyProduct.create({
          data: { category, name, perBox, supplyPrice, sortOrder: nextSort++, active: true },
        }),
      );
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);
  revalidatePath("/admin/weekly/prices");
  revalidatePath("/weekly");
  return { ok: true };
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

// 관리자 '발주 확인' — 점주 주간발주(발주 요청)를 확인 처리. 이후 계산서 발행 단계로.
export async function confirmWeeklyOrderAction(formData: FormData) {
  const admin = await requireAdmin();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return;
  const upd = await prisma.weeklyOrder.updateMany({
    where: { id: orderId, confirmed: false },
    data: { confirmed: true, confirmedAt: new Date() },
  });
  if (upd.count === 0) return;
  const o = await prisma.weeklyOrder.findUnique({
    where: { id: orderId },
    select: { userId: true, weekKey: true },
  });
  await writeAudit({
    action: "weeklyOrder.confirm",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "weeklyOrder",
    targetId: orderId,
    summary: `주간발주 확인 · ${o?.weekKey ?? ""}`,
  });
  revalidatePath("/admin/weekly");
  if (o) revalidatePath(`/admin/weekly/${o.userId}`);
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
