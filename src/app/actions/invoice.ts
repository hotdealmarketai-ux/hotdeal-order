"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMerchant } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import {
  CATEGORY_ORDER,
  isMerchant,
  type Category,
  type Role,
} from "@/lib/constants";
import {
  notifyMerchantInvoiceIssued,
  notifyMerchantInvoiceRevised,
  notifyMerchantInvoicePaid,
  notifyMerchantSplitApproved,
  notifyMerchantSplitRejected,
} from "@/lib/push";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { clearOrderUnlockIfSettled } from "@/lib/bank";
import { clearWeeklyUnlockIfSettled } from "@/lib/weekly";

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
// strict=false(임시저장·카테고리 확정): 형식이 안 맞는 줄은 조용히 건너뛴다(작성 중이라 허용).
// strict=true(발행): 한 줄이라도 형식 오류면 거부(돈 원칙).
function cleanItems(
  raw: RawItem[],
  strict = true,
): CleanItem[] | { error: string } {
  const out: CleanItem[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const category = String(r.category ?? "") as Category;
    if (!CATEGORY_ORDER.includes(category)) continue;
    const name = String(r.name ?? "").trim().slice(0, 100);
    const qtyRaw = String(r.qty ?? "").trim();
    const priceRaw = String(r.unitPrice ?? "").trim();
    if (!name && !qtyRaw && !priceRaw) continue; // 빈 줄은 건너뜀
    if (!name) {
      if (!strict) continue;
      return { error: "품목명이 비어 있는 줄이 있어요." };
    }
    const qty = parseQtyStrict(qtyRaw);
    if (qty == null) {
      if (!strict) continue;
      return { error: `'${name}' 수량을 확인해 주세요. (숫자만, 예: 4 또는 0.5)` };
    }
    const unitPrice = parsePriceStrict(priceRaw);
    if (unitPrice == null) {
      if (!strict) continue;
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
  // #11 mode: issue(발행) | confirm(카테고리 확정=DRAFT 저장) | draft(임시저장)
  const modeRaw = String(formData.get("mode") ?? "draft");
  const isIssue = modeRaw === "issue";
  // 확정된 카테고리 CSV + 이 계산서의 전체 카테고리(발행 게이트 판정용)
  const allCats = String(formData.get("allCats") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  // 여러 컴퓨터에서 카테고리별로 따로 확정해도 서로 덮어쓰지 않게 — 확정/수정은 '토글한 그 카테고리'만
  // 저장하고, confirmedCats도 폼 전체가 아니라 DB값에 델타(추가/삭제)로만 반영한다.
  const confirmCat = String(formData.get("confirmCat") ?? "");
  const confirmOn = String(formData.get("confirmOn") ?? "1") === "1";

  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { error: "잘못된 요청이에요." };
  }

  const merchant = await prisma.user.findUnique({ where: { id: userId } });
  if (!merchant || !isMerchant(merchant.role as Role)) {
    return { error: "점포를 찾을 수 없어요." };
  }

  // ── 발행(issue): 폼 payload로 품목을 덮어쓰지 않고, DB에 쌓인 품목/확정을 기준으로 마무리한다.
  //    (다른 컴퓨터가 채운 카테고리가 이 발행 폼엔 없어도 지워지지 않게.) ──
  if (isIssue) {
    if (!invoiceId) return { error: "먼저 카테고리를 확정해 주세요." };
    const inv = await prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: { items: { select: { amount: true } } },
    });
    if (!inv) return { error: "계산서를 찾을 수 없어요." };
    if (inv.status !== "DRAFT") {
      return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
    }
    const dbConfirmed = new Set(
      String(inv.confirmedCats ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    );
    // #11 발행 게이트 — 4개 카테고리 모두 'DB 기준' 확정돼야 발행(빈 카테고리도 확정 대상).
    if (allCats.length > 0 && allCats.some((c) => !dbConfirmed.has(c))) {
      return { error: "모든 품목(과일·야채·공구·채움채)을 확정해야 발행할 수 있어요." };
    }
    if (inv.items.length === 0) {
      return { error: "품목을 한 개 이상 입력하세요." };
    }
    const total = inv.items.reduce((n, it) => n + it.amount, 0);
    // 상태 가드를 쓰기 연산 자체에 — 동시 발행/저장 레이스로 불법 전이 차단.
    const upd = await prisma.invoice.updateMany({
      where: { id: invoiceId, status: "DRAFT" },
      data: { status: "ISSUED", issuedAt: new Date(), total },
    });
    if (upd.count === 0) {
      return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
    }
    await notifyMerchantInvoiceIssued(userId, invoiceId);
    revalidatePath("/admin/invoices");
    revalidatePath("/admin/deposits");
    revalidatePath(`/admin/combined/${userId}/${date}`);
    revalidatePath("/admin");
    redirect(`/admin/invoices/${invoiceId}?issued=1`);
  }

  // ── 확정/수정(confirm): 폼 payload에 담긴 '그 카테고리 품목'만 교체, 나머지 카테고리는 보존. ──
  let raw: RawItem[] = [];
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    raw = [];
  }
  const cleaned = cleanItems(Array.isArray(raw) ? raw : [], false); // 임시저장이라 형식오류 줄은 건너뜀
  const items = "error" in cleaned ? [] : cleaned;
  // 이번 저장에 실제로 담긴(품목이 있는) 카테고리 — 이 카테고리들만 교체하고 나머지는 안 건드린다.
  const submittedCats = [...new Set(items.map((it) => it.category))];

  const existing = invoiceId
    ? await prisma.invoice.findUnique({ where: { id: invoiceId } })
    : null;
  if (existing && existing.status !== "DRAFT") {
    return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
  }

  // confirmedCats 델타 — DB값 기준으로 확정이면 추가, 수정(해제)이면 삭제(폼 전체로 덮지 않음).
  const confSet = new Set(
    String(existing?.confirmedCats ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (CATEGORY_ORDER.includes(confirmCat as Category)) {
    if (confirmOn) confSet.add(confirmCat);
    else confSet.delete(confirmCat);
  }
  const newConfirmed = [...confSet].join(",");

  let id = invoiceId;
  try {
    if (existing) {
      await prisma.$transaction(async (tx) => {
        const upd = await tx.invoice.updateMany({
          where: { id: existing.id, status: "DRAFT" },
          data: { confirmedCats: newConfirmed },
        });
        if (upd.count === 0) throw new Error("INVOICE_NOT_DRAFT");
        // 이 저장에 담긴 카테고리 품목만 교체 — 다른 컴퓨터가 넣은 다른 카테고리는 그대로 둔다.
        if (submittedCats.length > 0) {
          await tx.invoiceItem.deleteMany({
            where: { invoiceId: existing.id, category: { in: submittedCats } },
          });
          await tx.invoiceItem.createMany({
            data: items.map((it, i) => ({ ...it, sortOrder: i, invoiceId: existing.id })),
          });
        }
        const all = await tx.invoiceItem.findMany({
          where: { invoiceId: existing.id },
          select: { amount: true },
        });
        await tx.invoice.update({
          where: { id: existing.id },
          data: { total: all.reduce((n, it) => n + it.amount, 0) },
        });
      });
      id = existing.id;
    } else {
      // 새 계산서 — 첫 확정. 제출된 품목으로 생성.
      const total = items.reduce((n, it) => n + it.amount, 0);
      const created = await prisma.invoice.create({
        data: {
          userId,
          date,
          total,
          status: "DRAFT",
          confirmedCats: newConfirmed,
          items: { create: items.map((it, i) => ({ ...it, sortOrder: i })) },
        },
      });
      id = created.id;
    }
  } catch (err) {
    if ((err as Error)?.message === "INVOICE_NOT_DRAFT") {
      return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
    }
    if ((err as { code?: string })?.code === "P2002") {
      return { error: "이 날짜 계산서가 이미 있어요. 기존 계산서에서 이어서 진행해 주세요." };
    }
    console.error("[invoice] save failed:", err);
    return { error: "저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // #10 빈 계산서 방지 — 품목 0건 + 확정 0개면 초안 삭제(빈 '작성중' 안 남김).
  const remaining = await prisma.invoiceItem.count({ where: { invoiceId: id } });
  if (remaining === 0 && confSet.size === 0) {
    await prisma.invoice.deleteMany({ where: { id, status: "DRAFT" } });
    revalidatePath("/admin/invoices");
    revalidatePath(`/admin/combined/${userId}/${date}`);
    revalidatePath("/admin");
    redirect("/admin/invoices");
  }

  revalidatePath("/admin/invoices");
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/combined/${userId}/${date}`);
  revalidatePath("/admin");
  redirect(`/admin/invoices/${id}?saved=1`);
}

// 발행된(입금대기 ISSUED) 계산서를 제자리에서 수정·재발송한다.
// 기존 계산서를 지우거나 새로 만들지 않고 '같은 계산서(같은 id)'의 품목/합계만 교체한다 →
//  · 점주의 기존 알림·링크가 그대로 유효(404·중복 없음)
//  · '발행된 계산서' 목록에 중복이 안 생김
//  · issuedAt(최초 발행)·입금매칭 이력 보존, revisedAt만 새로 찍음
// PAID(입금완료)/VOID(취소)/DRAFT(작성중)는 수정 불가.
export async function reviseInvoiceAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  const admin = await requireAdmin();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return { error: "잘못된 요청이에요." };

  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { userId: true, date: true, status: true, kind: true },
  });
  if (!inv) return { error: "계산서를 찾을 수 없어요." };
  if (inv.status !== "ISSUED") {
    return { error: "입금대기 중인 계산서만 수정할 수 있어요." };
  }
  // 주간발주 계산서는 발행 후 잠금(기존 규칙) — 일반발주(DAILY)만 제자리 수정 허용.
  if (inv.kind !== "DAILY") {
    return { error: "주간발주 계산서는 수정할 수 없어요." };
  }

  // 발행(재발송)이므로 엄격 검증(돈 원칙) — 한 줄이라도 형식 오류면 거부.
  let raw: RawItem[] = [];
  try {
    raw = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    raw = [];
  }
  const cleaned = cleanItems(Array.isArray(raw) ? raw : [], true);
  if ("error" in cleaned) return cleaned;
  const items = cleaned;
  if (items.length === 0) return { error: "품목을 한 개 이상 입력하세요." };
  const total = items.reduce((n, it) => n + it.amount, 0);

  try {
    await prisma.$transaction(async (tx) => {
      // 상태 가드를 쓰기 자체에 — 수정 도중 입금확인/취소로 전이되면 count 0 → 중단(레이스 차단).
      const upd = await tx.invoice.updateMany({
        where: { id: invoiceId, status: "ISSUED" },
        data: { total, revisedAt: new Date() },
      });
      if (upd.count === 0) throw new Error("INVOICE_NOT_ISSUED");
      // 품목 통째 교체(제출된 전체 payload가 최종본) — 부분 병합 아님.
      await tx.invoiceItem.deleteMany({ where: { invoiceId } });
      await tx.invoiceItem.createMany({
        data: items.map((it, i) => ({ ...it, sortOrder: i, invoiceId })),
      });
    });
  } catch (err) {
    if ((err as Error)?.message === "INVOICE_NOT_ISSUED") {
      return { error: "입금대기 중인 계산서만 수정할 수 있어요. (이미 입금확인/취소됨)" };
    }
    console.error("[invoice] revise failed:", err);
    return { error: "수정에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  await writeAudit({
    action: "invoice.revise",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: invoiceId,
    summary: `계산서 수정·재발송 · ${inv.date} · ${total.toLocaleString("ko-KR")}원`,
  });
  // 점주에게 '계산서가 수정되었습니다 + 바뀐 금액' 재발송(같은 계산서로 이동).
  await notifyMerchantInvoiceRevised(inv.userId, invoiceId, total);
  revalidatePath("/admin/invoices");
  revalidatePath(`/admin/invoices/${invoiceId}`);
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/combined/${inv.userId}/${inv.date}`);
  revalidatePath(`/order/day/${inv.date}`);
  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/admin");
  redirect(`/admin/invoices/${invoiceId}?revised=1`);
}

// 발행된 계산서 취소(VOID) — 되돌릴 수 없음, 재작성은 합본 발주서에서
// (모든 상태 전이는 updateMany + status 조건으로 '쓰기 시점'에 가드 — 동시 클릭 레이스 차단)
export async function voidInvoiceAction(formData: FormData) {
  const admin = await requireAdmin();
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
  await writeAudit({
    action: "invoice.void",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: id,
    summary: `계산서 취소(VOID) · ${inv?.date ?? ""}`,
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
    select: {
      userId: true,
      date: true,
      total: true,
      issuedAt: true,
      _count: { select: { items: true } },
    },
  });
  if (inv) {
    // 이 점포의 '미소진 매칭 입금'을 이 계산서에 귀속(소진)한다.
    //  · 옛 버그#7/#11: inv.date '하루'로만 찾아 '발행 다음날' 실입금을 놓치고 합성입금을 전액
    //    만들어 통장이 2배로 부풀었다 → 발행(issuedAt) 이후 도착분 전체를 후보로.
    //  · 옛 버그#8/#12: 금액 상한이 없어 큰 실입금이 작은 계산서에 통째로 묻혔다 → 금액 정확일치
    //    1건 우선, 없으면 합이 total을 넘지 않게 오래된 순으로만 흡수.
    const cands = await prisma.deposit.findMany({
      where: {
        matchedUserId: inv.userId,
        appliedInvoiceId: null,
        matchStatus: { in: ["AUTO", "MANUAL"] },
        txAt: { gte: inv.issuedAt ?? new Date(0) },
      },
      orderBy: { txAt: "asc" },
      select: { id: true, amount: true },
    });
    let attributed = 0;
    const applyIds: string[] = [];
    const exact = cands.find((d) => d.amount === inv.total);
    if (exact) {
      applyIds.push(exact.id);
      attributed = exact.amount;
    } else {
      for (const d of cands) {
        if (attributed + d.amount > inv.total) continue; // 넘치면 다른 계산서 몫일 수 있어 손대지 않음
        applyIds.push(d.id);
        attributed += d.amount;
        if (attributed >= inv.total) break;
      }
    }
    if (applyIds.length > 0) {
      await prisma.deposit.updateMany({
        where: { id: { in: applyIds } },
        data: { appliedInvoiceId: id },
      });
    }
    // 실입금으로 못 채운 잔액만 '수동입금확인' 합성입금으로 기록(통장 완결성). 전액 충당됐으면
    // 이전에 남았을 합성입금을 제거해 이중계상 방지.
    const shortfall = inv.total - attributed;
    if (shortfall > 0) {
      const now = new Date();
      await prisma.deposit.upsert({
        where: { bankTid: `manual-${id}` },
        create: {
          bankTid: `manual-${id}`,
          txAt: now,
          amount: shortfall,
          payerName: "수동 입금확인",
          memo: "관리자 수동 입금확인",
          matchStatus: "MANUAL",
          matchedUserId: inv.userId,
          matchedAt: now,
          appliedInvoiceId: id,
        },
        update: {
          amount: shortfall,
          txAt: now,
          matchStatus: "MANUAL",
          matchedUserId: inv.userId,
          matchedAt: now,
          appliedInvoiceId: id,
        },
      });
    } else {
      await prisma.deposit.deleteMany({ where: { bankTid: `manual-${id}` } });
    }
    await notifyMerchantInvoicePaid(inv.userId, inv.date, inv._count.items, inv.total);
    await clearOrderUnlockIfSettled(inv.userId);
    await clearWeeklyUnlockIfSettled(inv.userId);
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
  // '수동입금확인'으로 만든 합성 입금기록은 삭제(내역에서 제거)
  await prisma.deposit.deleteMany({ where: { bankTid: `manual-${id}` } });
  // 이 계산서에 귀속됐던 (실제) 입금을 다시 미소진으로 되돌림
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

// 분할 입금 승인(관리자) — 나눠 입금 허용. 발주 잠금 해제(완납 시 자동 원복) + 점주 알림.
// 분할 건은 splitRequested 유지 → 자동매칭에서 계속 제외(사람이 확정).
export async function approveSplitAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id) return;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { userId: true, date: true, total: true },
  });
  if (!inv) return;
  // 쓰기 시점 가드 — ISSUED + 분할요청일 때만 승인(경합/취소/완납 전이 시 count 0 → 중단)
  const upd = await prisma.invoice.updateMany({
    where: { id, status: "ISSUED", splitRequested: true },
    data: { splitApprovedAt: new Date() },
  });
  if (upd.count === 0) return;
  // 승인은 '나눠 입금 허용' 통지·기록만. 발주 잠금은 자동으로 풀지 않는다(관리자 수동 해제).
  await writeAudit({
    action: "invoice.splitApprove",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: id,
    summary: `분할 입금 승인 · ${inv.date} · ${inv.total.toLocaleString("ko-KR")}원`,
  });
  await notifyMerchantSplitApproved(inv.userId, inv.date);
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${inv.userId}`);
  revalidatePath(`/order/day/${inv.date}`);
  revalidatePath("/admin");
}

// 분할 입금 반려(관리자) — 요청 취소. 전액 입금 안내 + 점주 알림. 자동매칭 재개.
export async function rejectSplitAction(formData: FormData) {
  const admin = await requireAdmin();
  const id = String(formData.get("invoiceId") ?? "");
  if (!id) return;
  const inv = await prisma.invoice.findUnique({
    where: { id },
    select: { userId: true, date: true, total: true },
  });
  if (!inv) return;
  const upd = await prisma.invoice.updateMany({
    where: { id, splitRequested: true },
    data: { splitRequested: false, splitRequestedAt: null, splitApprovedAt: null },
  });
  if (upd.count === 0) return;
  // 반려는 요청 취소·통지·기록만. 발주 잠금은 건드리지 않는다(수동 해제와 독립).
  await writeAudit({
    action: "invoice.splitReject",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: id,
    summary: `분할 입금 반려 · ${inv.date} · ${inv.total.toLocaleString("ko-KR")}원`,
  });
  await notifyMerchantSplitRejected(inv.userId, inv.date);
  revalidatePath("/admin/deposits");
  revalidatePath(`/admin/deposits/${inv.userId}`);
  revalidatePath(`/order/day/${inv.date}`);
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
