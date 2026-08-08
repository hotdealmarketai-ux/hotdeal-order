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
  notifyMerchantRefundIssued,
  notifyMerchantRefundRevised,
} from "@/lib/push";

type RefundRow = { name?: unknown; qty?: unknown; unitPrice?: unknown };
type RefundItem = { name: string; qty: number; unitPrice: number; amount: number };

// 환불 품목 파싱 — 발행·수정 공용. 수량·단가는 절대값(음수 방지), 무효 줄은 버린다.
// gross(양수 합계)를 함께 돌려준다. total은 이 값을 '음수'로 저장해 미수에서 차감.
function parseRefundItems(raw: string): { items: RefundItem[]; gross: number } {
  let rows: RefundRow[];
  try {
    rows = JSON.parse(raw || "[]");
  } catch {
    return { items: [], gross: 0 };
  }
  const items: RefundItem[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = String(r?.name ?? "").trim().slice(0, 100);
    const qty = Math.abs(Number(String(r?.qty ?? "").replace(/[^\d.]/g, "")) || 0);
    const unitPrice = Math.abs(
      Math.floor(Number(String(r?.unitPrice ?? "").replace(/[^\d]/g, "")) || 0),
    );
    if (!name || qty <= 0 || unitPrice <= 0) continue;
    items.push({ name, qty, unitPrice, amount: Math.round(qty * unitPrice) });
  }
  const gross = items.reduce((n, it) => n + it.amount, 0);
  return { items, gross };
}

// 환불계산서 발행 — 미수 차감용 계산서. 카테고리·재고 연동 없음(자유 입력).
// 미수 차감은 total을 '음수'로 저장해 처리 → receivableOf(=Σ ISSUED total + 조정)에 자동 반영.
// 전 화면(입금관리·계산서 발행·점주 마이/입금요청서)이 같은 공식을 써서 별도 계산 변경 불필요.
export async function issueRefundInvoiceAction(
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

  const { items, gross } = parseRefundItems(String(formData.get("items") ?? "[]"));
  if (items.length === 0) return { error: "환불 품목을 한 개 이상 입력하세요." };
  if (gross <= 0) return { error: "환불 금액이 0보다 커야 해요." };

  const created = await prisma.invoice.create({
    data: {
      userId,
      date,
      kind: "REFUND",
      status: "ISSUED",
      total: -gross, // 음수 = 미수 차감
      issuedAt: new Date(),
      items: {
        create: items.map((it, i) => ({
          category: "REFUND",
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
    action: "invoice.refundIssue",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: created.id,
    summary: `${store.storeName} 환불계산서 ${gross.toLocaleString("ko-KR")}원 발행(미수 차감)`,
  }).catch(() => {});
  await notifyMerchantRefundIssued(userId, created.id, gross).catch(() => {});

  revalidatePath(`/admin/billing/${userId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  revalidatePath("/invoices");
  revalidatePath("/mypage");
  redirect(`/admin/billing/${userId}`);
}

// 환불계산서 제자리 수정·재발송 — 같은 계산서(같은 id)의 품목·환불액·일자만 교체.
//  · 삭제/재생성 없음 → 점주의 기존 알림·링크 유효(404·중복 없음), issuedAt(최초 발행) 보존, revisedAt만 갱신.
//  · 미수는 total(음수)를 바꾸면 receivableOf(=Σ ISSUED total + 조정)가 자동 반영 → 별도 재계산 불필요.
//  · 재고·카테고리 연동 없음(환불은 자유입력). ISSUED만 수정 가능(VOID=취소 완료분은 불가).
export async function reviseRefundInvoiceAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!invoiceId) return { error: "잘못된 요청이에요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "날짜를 확인하세요." };

  const inv = await prisma.invoice.findFirst({
    where: { id: invoiceId, kind: "REFUND" },
    select: {
      userId: true,
      status: true,
      total: true, // 수정 전 환불액(음수) — 수정 내역 before로 기록
      items: { select: { category: true, name: true, qty: true, unitPrice: true, amount: true } },
    },
  });
  if (!inv) return { error: "환불계산서를 찾을 수 없어요." };
  if (inv.status !== "ISSUED") {
    return { error: "취소된 환불계산서는 수정할 수 없어요." };
  }

  const { items, gross } = parseRefundItems(String(formData.get("items") ?? "[]"));
  if (items.length === 0) return { error: "환불 품목을 한 개 이상 입력하세요." };
  if (gross <= 0) return { error: "환불 금액이 0보다 커야 해요." };

  try {
    await prisma.$transaction(async (tx) => {
      // 상태 가드를 쓰기 자체에 — 수정 도중 취소(VOID)로 전이되면 count 0 → 중단(레이스 차단).
      const upd = await tx.invoice.updateMany({
        where: { id: invoiceId, kind: "REFUND", status: "ISSUED" },
        data: { total: -gross, date, revisedAt: new Date() },
      });
      if (upd.count === 0) throw new Error("REFUND_NOT_ISSUED");
      // 환불 품목(전부 category=REFUND)을 통째 교체 — 제출 payload가 최종본.
      await tx.invoiceItem.deleteMany({ where: { invoiceId } });
      await tx.invoiceItem.createMany({
        data: items.map((it, i) => ({
          invoiceId,
          category: "REFUND",
          sortOrder: i,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: it.amount,
        })),
      });
    });
  } catch (err) {
    if ((err as Error)?.message === "REFUND_NOT_ISSUED") {
      return { error: "취소된 환불계산서는 수정할 수 없어요. (이미 취소됨)" };
    }
    logError("refund.revise", err, { invoiceId });
    return { error: "수정에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // 수정 내역 스냅샷(무엇이 추가/변경/제거됐는지 + 환불액 변화). 점주·관리자 공통 열람.
  try {
    const after = items.map((it) => ({
      category: "REFUND",
      name: it.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    }));
    const changes = diffInvoiceItems(inv.items, after);
    if (changes.length > 0 || inv.total !== -gross) {
      await prisma.invoiceRevision.create({
        data: {
          invoiceId,
          totalBefore: inv.total,
          totalAfter: -gross,
          changes: JSON.stringify(changes),
        },
      });
    }
  } catch (e) {
    logError("refund.revise.history", e, { invoiceId });
  }

  await writeAudit({
    action: "invoice.refundRevise",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: invoiceId,
    summary: `환불계산서 수정·재발송 ${gross.toLocaleString("ko-KR")}원(미수 차감)`,
  }).catch(() => {});
  await notifyMerchantRefundRevised(inv.userId, invoiceId, gross).catch(() => {});

  revalidatePath(`/admin/billing/${inv.userId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/deposits");
  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/mypage");
  redirect(`/admin/invoices/${invoiceId}?refundRevised=1`);
}

// 환불계산서 취소(관리자) — status VOID로 바꿔 미수 차감을 되돌린다(잘못 발행 정정).
export async function voidRefundAction(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (!id) return;
  const inv = await prisma.invoice.findFirst({
    where: { id, kind: "REFUND", status: "ISSUED" },
    select: { userId: true, total: true },
  });
  if (!inv) return;
  // 상태 전이를 쓰기 시점에 가드 — 동시 클릭/이중 요청 레이스 차단(중복 감사로그 방지).
  const upd = await prisma.invoice.updateMany({
    where: { id, kind: "REFUND", status: "ISSUED" },
    data: { status: "VOID", voidedAt: new Date() },
  });
  if (upd.count === 0) return; // 이미 취소됨 — 감사/리다이렉트 생략
  await writeAudit({
    action: "invoice.refundVoid",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Invoice",
    targetId: id,
    summary: `환불계산서 취소 ${Math.abs(inv.total).toLocaleString("ko-KR")}원(미수 복구)`,
  }).catch(() => {});
  revalidatePath(`/admin/billing/${inv.userId}`);
  revalidatePath("/admin/billing");
  revalidatePath("/admin/invoices");
  revalidatePath("/invoices");
  revalidatePath("/mypage");
  redirect(`/admin/billing/${inv.userId}`);
}
