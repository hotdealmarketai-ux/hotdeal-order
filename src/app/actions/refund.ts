"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { isMerchant, type Role } from "@/lib/constants";
import { writeAudit } from "@/lib/audit";
import { notifyMerchantRefundIssued } from "@/lib/push";

type RefundRow = { name?: unknown; qty?: unknown; unitPrice?: unknown };

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

  let rows: RefundRow[];
  try {
    rows = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    return { error: "품목을 다시 입력해 주세요." };
  }
  const items: { name: string; qty: number; unitPrice: number; amount: number }[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const name = String(r?.name ?? "").trim().slice(0, 100);
    const qty = Math.abs(Number(String(r?.qty ?? "").replace(/[^\d.]/g, "")) || 0);
    const unitPrice = Math.abs(
      Math.floor(Number(String(r?.unitPrice ?? "").replace(/[^\d]/g, "")) || 0),
    );
    if (!name || qty <= 0 || unitPrice <= 0) continue;
    items.push({ name, qty, unitPrice, amount: Math.round(qty * unitPrice) });
  }
  if (items.length === 0) return { error: "환불 품목을 한 개 이상 입력하세요." };
  const gross = items.reduce((n, it) => n + it.amount, 0);
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
  await prisma.invoice.update({
    where: { id },
    data: { status: "VOID", voidedAt: new Date() },
  });
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
