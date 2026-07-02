"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMerchant } from "@/lib/session";
import {
  CATEGORY_ORDER,
  isMerchant,
  type Category,
  type Role,
} from "@/lib/constants";
import {
  notifyMerchantInvoiceIssued,
  notifyMerchantInvoicePaid,
} from "@/lib/push";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { clearOrderUnlockIfSettled } from "@/lib/bank";
import { kstDayRange } from "@/lib/date";

export type InvoiceFormState = { error?: string };

type RawItem = {
  category?: string;
  name?: string;
  qty?: string;
  unitPrice?: string;
};

type CleanItem = {
  category: Category;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

const MAX_ITEMS = 200;

// payload(JSON) → 검증된 품목. 금액은 서버에서만 계산(클라이언트 값 신뢰 안 함).
// 수량/단가는 '전체 문자열' 엄격 파싱 — "1/2"·"1,500.00"·"-5000" 같은 값은
// 조용히 왜곡되지 않고 반드시 에러로 거부된다(돈 원칙).
function cleanItems(raw: RawItem[]): CleanItem[] | { error: string } {
  const out: CleanItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const category = String(r.category ?? "") as Category;
    if (!CATEGORY_ORDER.includes(category)) continue;
    const name = String(r.name ?? "").trim().slice(0, 100);
    const qtyRaw = String(r.qty ?? "").trim();
    const priceRaw = String(r.unitPrice ?? "").trim();
    if (!name && !qtyRaw && !priceRaw) continue; // 빈 줄은 건너뜀
    if (!name) return { error: "품목명이 비어 있는 줄이 있어요." };
    const qty = parseQtyStrict(qtyRaw);
    if (qty == null) {
      return { error: `'${name}' 수량을 확인해 주세요. (숫자만, 예: 4 또는 0.5)` };
    }
    const unitPrice = parsePriceStrict(priceRaw);
    if (unitPrice == null) {
      return { error: `'${name}' 단가를 확인해 주세요. (원 단위 숫자만)` };
    }
    out.push({
      category,
      name,
      qty,
      unitPrice,
      amount: Math.round(qty * unitPrice),
    });
  }
  return out;
}

// 계산서 저장(임시저장) / 발행 — invoiceId 없으면 생성, 있으면 DRAFT만 수정 가능
export async function saveInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  await requireAdmin();

  const invoiceId = String(formData.get("invoiceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const date = String(formData.get("date") ?? "");
  const mode = formData.get("mode") === "issue" ? "issue" : "draft";

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
  const items = cleanItems(Array.isArray(raw) ? raw : []);
  if ("error" in items) return items;
  if (items.length === 0) {
    return { error: "품목을 한 개 이상 입력하세요." };
  }

  // 같은 점포·같은 날짜에 계산서는 1장(취소된 건 제외)
  const dupe = await prisma.invoice.findFirst({
    where: {
      userId,
      date,
      status: { not: "VOID" },
      ...(invoiceId ? { id: { not: invoiceId } } : {}),
    },
    select: { id: true },
  });
  if (dupe) {
    return { error: "이 날짜 계산서가 이미 있어요. 기존 계산서에서 이어서 진행해 주세요." };
  }

  const total = items.reduce((n, it) => n + it.amount, 0);
  const itemRows = items.map((it, i) => ({ ...it, sortOrder: i }));
  const data = {
    userId,
    date,
    total,
    status: mode === "issue" ? "ISSUED" : "DRAFT",
    issuedAt: mode === "issue" ? new Date() : null,
  };

  let id = invoiceId;
  try {
    if (invoiceId) {
      const inv = await prisma.invoice.findUnique({ where: { id: invoiceId } });
      if (!inv) return { error: "계산서를 찾을 수 없어요." };
      if (inv.status !== "DRAFT") {
        return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
      }
      // 상태 가드를 '쓰기 연산 자체'에 둔다 — 동시 발행/저장 레이스로
      // ISSUED가 DRAFT로 되돌아가는 불법 전이를 DB 레벨에서 차단.
      await prisma.$transaction(async (tx) => {
        const upd = await tx.invoice.updateMany({
          where: { id: invoiceId, status: "DRAFT" },
          data,
        });
        if (upd.count === 0) throw new Error("INVOICE_NOT_DRAFT");
        await tx.invoiceItem.deleteMany({ where: { invoiceId } });
        await tx.invoiceItem.createMany({
          data: itemRows.map((r) => ({ ...r, invoiceId })),
        });
      });
    } else {
      const created = await prisma.invoice.create({
        data: { ...data, items: { create: itemRows } },
      });
      id = created.id;
    }
  } catch (err) {
    if ((err as Error)?.message === "INVOICE_NOT_DRAFT") {
      return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
    }
    // 동시 저장 레이스 → DB 부분 유니크 인덱스(점포+날짜, 취소 제외)가 막음
    if ((err as { code?: string })?.code === "P2002") {
      return { error: "이 날짜 계산서가 이미 있어요. 기존 계산서에서 이어서 진행해 주세요." };
    }
    console.error("[invoice] save failed:", err);
    return { error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  if (mode === "issue") {
    await notifyMerchantInvoiceIssued(userId, date);
  }

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/combined/${userId}/${date}`);
  revalidatePath("/admin");
  redirect(`/admin/invoices/${id}?${mode === "issue" ? "issued" : "saved"}=1`);
}

// 발행된 계산서 취소(VOID) — 되돌릴 수 없음, 재작성은 합본 발주서에서
// (모든 상태 전이는 updateMany + status 조건으로 '쓰기 시점'에 가드 — 동시 클릭 레이스 차단)
export async function voidInvoiceAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id || String(formData.get("confirm") ?? "") !== "VOID-INVOICE") return;
  const upd = await prisma.invoice.updateMany({
    where: { id, status: "ISSUED" },
    data: { status: "VOID", voidedAt: new Date() },
  });
  if (upd.count === 0) return; // 이미 다른 상태로 전이됨 → 무시
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { userId: true, date: true },
  });
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  if (inv) revalidatePath(`/admin/combined/${inv.userId}/${inv.date}`);
  revalidatePath("/admin");
}

// 입금 확인(수동) — 분할입금·차액 등 자동매칭이 못 잡는 건을 관리자가 확정.
// manualPaid=true로 표시해 이후 자동매칭이 되돌리지 못하게 한다.
export async function markInvoicePaidAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, status: "ISSUED" },
    data: { status: "PAID", paidAt: new Date(), manualPaid: true },
  });
  if (upd.count === 0) return;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { userId: true, date: true, total: true, _count: { select: { items: true } } },
  });
  if (inv) {
    // 이 계산서 날짜에 그 점포로 들어온 '미소진' 매칭 입금을 이 계산서에 귀속(소진)
    const { start, end } = kstDayRange(inv.date);
    await prisma.deposit.updateMany({
      where: {
        matchedUserId: inv.userId,
        appliedInvoiceId: null,
        txAt: { gte: start, lt: end },
      },
      data: { appliedInvoiceId: id },
    });
    await notifyMerchantInvoicePaid(inv.userId, inv.date, inv._count.items, inv.total);
    await clearOrderUnlockIfSettled(inv.userId);
    revalidatePath(`/order/day/${inv.date}`);
  }
  revalidatePath("/admin/deposits");
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin");
}

// 입금 확인 취소(실수 복구) — PAID → ISSUED
export async function unmarkInvoicePaidAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, status: "PAID" },
    data: { status: "ISSUED", paidAt: null, manualPaid: false },
  });
  if (upd.count === 0) return;
  // 이 계산서에 귀속됐던 입금을 다시 미소진으로 되돌림
  await prisma.deposit.updateMany({
    where: { appliedInvoiceId: id },
    data: { appliedInvoiceId: null },
  });
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { date: true } });
  if (inv) revalidatePath(`/order/day/${inv.date}`);
  revalidatePath("/admin/deposits");
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${id}`);
  revalidatePath("/admin");
}

// 분할 입금 요청 — 점주가 나눠 입금하겠다고 알림(관리자 수동 확인 유도)
export async function requestSplitPaymentAction(formData: FormData) {
  const user = await requireMerchant();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, userId: user.id, status: "ISSUED" },
    data: { splitRequested: true, splitRequestedAt: new Date() },
  });
  if (upd.count === 0) return;
  const inv = await prisma.invoice.findUnique({ where: { id }, select: { date: true } });
  if (inv) revalidatePath(`/order/day/${inv.date}`);
  revalidatePath("/admin/deposits");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin");
}

// 작성중(DRAFT) 계산서 삭제 — 발행 직후 삭제 레이스도 status 조건으로 차단
export async function deleteInvoiceDraftAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id) return;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { userId: true, date: true },
  });
  const del = await prisma.invoice.deleteMany({
    where: { id, status: "DRAFT" },
  });
  if (del.count > 0 && inv) {
    revalidatePath("/admin/invoices");
    revalidatePath(`/admin/combined/${inv.userId}/${inv.date}`);
  }
  redirect("/admin/invoices");
}
