"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import { diffInvoiceItems } from "@/lib/invoice-revision";
import {
  notifyMerchantSadadreamIssued,
  notifyMerchantSadadreamRevised,
} from "@/lib/push";

// 사다드림 계산서 — 우리 계좌가 아닌 '개인/개인업체'로 결제하는 대리구매(사다드림) 청구.
//  · 환불계산서와 동일한 자유입력(품목/수량/단가, 재고·카테고리 무관)이되 total 은 '양수'.
//  · 맨 위에 입금계좌(은행/예금주/계좌번호)를 발행 시점에 입력해 계산서에 스냅샷 저장.
//  · kind="SADADREAM" 은 '사다드림 미수' 별도 트랙 — 전체 미수(receivableOf)에는 절대 포함되지 않는다.
//    입금확인은 팝빌 매칭이 아니라 이 계산서를 낱장으로 status=PAID 전이(일일이 따로 확인). 사다드림 미수=Σ ISSUED SADADREAM.

type Row = { name?: unknown; qty?: unknown; unitPrice?: unknown };
type Item = { name: string; qty: number; unitPrice: number; amount: number };

function parseItems(raw: string): { items: Item[]; gross: number } {
  let rows: Row[];
  try {
    rows = JSON.parse(raw || "[]");
  } catch {
    return { items: [], gross: 0 };
  }
  const items: Item[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = String(r?.name ?? "").trim().slice(0, 100);
    const qty = Math.abs(Number(String(r?.qty ?? "").replace(/[^\d.]/g, "")) || 0);
    const unitPrice = Math.abs(
      Math.floor(Number(String(r?.unitPrice ?? "").replace(/[^\d]/g, "")) || 0),
    );
    // 단가 0원 허용(무상 출고·샘플 등) — 이름과 수량만 있으면 유효 품목으로 담는다.
    if (!name || qty <= 0) continue;
    items.push({ name, qty, unitPrice, amount: Math.round(qty * unitPrice) });
  }
  const gross = items.reduce((n, it) => n + it.amount, 0);
  return { items, gross };
}

function readAccount(fd: FormData) {
  return {
    sdBank: String(fd.get("sdBank") ?? "").trim().slice(0, 40),
    sdHolder: String(fd.get("sdHolder") ?? "").trim().slice(0, 40),
    sdAccount: String(fd.get("sdAccount") ?? "").trim().slice(0, 60),
  };
}

// 사다드림 계산서 발행. total 양수, 별도 트랙이라 전체 미수 계산엔 안 들어간다.
export async function issueSadadreamInvoiceAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!userId) return { error: "잘못된 요청이에요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "날짜를 확인하세요." };

  const store = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, storeName: true },
  });
  if (!store || !isMerchant(store.role as Role)) {
    return { error: "점포를 찾을 수 없어요." };
  }

  const { items, gross } = parseItems(String(formData.get("items") ?? "[]"));
  if (items.length === 0) return { error: "품목을 한 개 이상 입력하세요." };
  // 사다드림은 무상 출고(0원)도 발행 허용 — gross 0 이어도 통과(음수는 발생하지 않음).
  const acct = readAccount(formData);
  // 사다드림은 개인/개인업체 계좌로 결제받는 계산서라 입금계좌가 없으면 '결제 불가' 계산서가 된다 → 필수.
  if (!acct.sdBank || !acct.sdAccount) return { error: "입금계좌(은행·계좌번호)를 입력하세요." };

  const created = await prisma.invoice.create({
    data: {
      userId,
      date,
      kind: "SADADREAM",
      status: "ISSUED",
      total: gross, // 양수 = 사다드림 미수(별도 트랙)
      issuedAt: new Date(),
      sdBank: acct.sdBank,
      sdHolder: acct.sdHolder,
      sdAccount: acct.sdAccount,
      items: {
        create: items.map((it, i) => ({
          category: "SADADREAM",
          sortOrder: i,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      },
    },
    select: { id: true },
  });

  await writeAudit({
    action: "invoice.sadadreamIssue",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: created.id,
    summary: `${store.storeName} 사다드림 계산서 ${gross.toLocaleString("ko-KR")}원 발행`,
  }).catch(() => {});
  await notifyMerchantSadadreamIssued(userId, created.id, gross).catch(() => {});

  revalidatePath(`/admin/billing/${userId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${userId}`);
  revalidatePath("/invoices");
  revalidatePath("/mypage");
  redirect(`/admin/billing/${userId}`);
}

// 사다드림 계산서 제자리 수정·재발송 — 같은 id 의 품목·금액·일자·계좌만 교체(발행 이력·링크 유지).
export async function reviseSadadreamInvoiceAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!invoiceId) return { error: "잘못된 요청이에요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "날짜를 확인하세요." };

  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, kind: "SADADREAM" },
    select: {
      userId: true,
      status: true,
      total: true,
      items: { select: { category: true, name: true, qty: true, unitPrice: true, amount: true } },
    },
  });
  if (!inv) return { error: "사다드림 계산서를 찾을 수 없어요." };
  if (inv.status !== "ISSUED") {
    return { error: "입금확인·취소된 계산서는 수정할 수 없어요." };
  }

  const { items, gross } = parseItems(String(formData.get("items") ?? "[]"));
  if (items.length === 0) return { error: "품목을 한 개 이상 입력하세요." };
  // 사다드림은 무상 출고(0원)도 발행 허용 — gross 0 이어도 통과(음수는 발생하지 않음).
  const acct = readAccount(formData);
  if (!acct.sdBank || !acct.sdAccount) return { error: "입금계좌(은행·계좌번호)를 입력하세요." };

  try {
    await prisma.$transaction(async (tx) => {
      const upd = await tx.invoice.updateMany({
        where: { id: invoiceId, kind: "SADADREAM", status: "ISSUED" },
        data: {
          total: gross,
          date,
          revisedAt: new Date(),
          sdBank: acct.sdBank,
          sdHolder: acct.sdHolder,
          sdAccount: acct.sdAccount,
        },
      });
      if (upd.count === 0) throw new Error("SADADREAM_NOT_ISSUED");
      await tx.invoiceItem.deleteMany({ where: { invoiceId } });
      await tx.invoiceItem.createMany({
        data: items.map((it, i) => ({
          invoiceId,
          category: "SADADREAM",
          sortOrder: i,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      });
    });
  } catch (err) {
    if ((err as Error)?.message === "SADADREAM_NOT_ISSUED") {
      return { error: "입금확인·취소된 계산서는 수정할 수 없어요." };
    }
    logError("sadadream.revise", err, { invoiceId });
    return { error: "수정에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  try {
    const after = items.map((it) => ({
      category: "SADADREAM",
      name: it.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    }));
    const changes = diffInvoiceItems(inv.items, after);
    if (changes.length > 0 || inv.total !== gross) {
      await prisma.invoiceRevision.create({
        data: {
          invoiceId,
          totalBefore: inv.total,
          totalAfter: gross,
          changes: JSON.stringify(changes),
        },
      });
    }
  } catch (e) {
    logError("sadadream.revise.history", e, { invoiceId });
  }

  await writeAudit({
    action: "invoice.sadadreamRevise",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: invoiceId,
    summary: `사다드림 계산서 수정·재발송 ${gross.toLocaleString("ko-KR")}원`,
  }).catch(() => {});
  await notifyMerchantSadadreamRevised(inv.userId, invoiceId, gross).catch(() => {});

  revalidatePath(`/admin/billing/${inv.userId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${inv.userId}`);
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/mypage");
  redirect(`/admin/invoices/${invoiceId}?sadadreamRevised=1`);
}

// 사다드림 계산서 취소(관리자) — VOID 로 전이(잘못 발행 정정). 사다드림 미수에서 빠진다.
export async function voidSadadreamAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const inv = await prisma.invoice.findFirst({
    where: { id, kind: "SADADREAM", status: { in: ["ISSUED", "PAID"] } },
    select: { userId: true, total: true },
  });
  if (!inv) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, kind: "SADADREAM", status: { in: ["ISSUED", "PAID"] } },
    data: { status: "VOID", voidedAt: new Date() },
  });
  if (upd.count === 0) return;
  await writeAudit({
    action: "invoice.sadadreamVoid",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: id,
    summary: `사다드림 계산서 취소 ${inv.total.toLocaleString("ko-KR")}원`,
  }).catch(() => {});
  revalidatePath(`/admin/billing/${inv.userId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${inv.userId}`);
  revalidatePath("/invoices");
  revalidatePath("/mypage");
}

// 사다드림 입금확인 — 낱장을 PAID 로 전이(일일이 따로 확인). 사다드림 미수(Σ ISSUED SADADREAM)에서 빠진다.
//  일반 미수의 '낱장 PAID 금지' 규칙과 독립(사다드림은 별도 트랙·수동 개별확인이라 안전).
export async function confirmSadadreamPaidAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const inv = await prisma.invoice.findFirst({
    where: { id, kind: "SADADREAM", status: "ISSUED" },
    select: { userId: true, total: true },
  });
  if (!inv) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, kind: "SADADREAM", status: "ISSUED" },
    data: { status: "PAID", paidAt: new Date() },
  });
  if (upd.count === 0) return;
  await writeAudit({
    action: "invoice.sadadreamPaid",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: id,
    summary: `사다드림 입금확인 ${inv.total.toLocaleString("ko-KR")}원`,
  }).catch(() => {});
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${inv.userId}`);
  revalidatePath("/admin/billing");
  revalidatePath(`/admin/billing/${inv.userId}`);
  revalidatePath("/invoices");
  revalidatePath("/mypage");
}

// 사다드림 입금확인 되돌리기 — PAID→ISSUED(오확인 정정). 사다드림 미수에 다시 잡힌다.
export async function unconfirmSadadreamPaidAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const inv = await prisma.invoice.findFirst({
    where: { id, kind: "SADADREAM", status: "PAID" },
    select: { userId: true, total: true },
  });
  if (!inv) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, kind: "SADADREAM", status: "PAID" },
    data: { status: "ISSUED", paidAt: null },
  });
  if (upd.count === 0) return;
  await writeAudit({
    action: "invoice.sadadreamUnpaid",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: id,
    summary: `사다드림 입금확인 취소 ${inv.total.toLocaleString("ko-KR")}원`,
  }).catch(() => {});
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${inv.userId}`);
  revalidatePath("/admin/billing");
  revalidatePath(`/admin/billing/${inv.userId}`);
  revalidatePath("/invoices");
  revalidatePath("/mypage");
}
