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
import {
  clearWeeklyUnlockIfSettled,
  getWeeklyItemsForStoreShipment,
  weeklyKeyForAnyShipmentDay,
} from "@/lib/weekly";
import { boxWord } from "@/lib/weekly-catalog";
import { orderRangeForShipment } from "@/lib/date";
import { Prisma } from "@prisma/client";
import {
  deductInvoiceStock,
  restoreInvoiceStock,
  applyInvoiceStockDelta,
  invoiceToolByName,
} from "@/lib/invoice-stock";
import { diffInvoiceItems } from "@/lib/invoice-revision";
import { logError } from "@/lib/log";

export type InvoiceFormState = { error?: string };

type RawItem = {
  category?: string;
  name?: string;
  qty?: string;
  unitPrice?: string;
  inventoryItemId?: string; // 공구칸 드롭다운으로 선택한 재고현황 상품 연동(있으면)
};

type CleanItem = {
  category: Category;
  name: string;
  qty: number;
  unitPrice: number;
  amount: number;
  inventoryItemId: string;
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
      // 연동은 공구(TOOL)만 의미 있음 — 다른 카테고리는 빈값.
      inventoryItemId:
        category === "TOOL" ? String(r.inventoryItemId ?? "").trim().slice(0, 40) : "",
    });
  }
  return out;
}

// ── 주간발주 합산분 — 계산서에 별도 카테고리(WEEKLY)로 붙는다. 일반 4카테고리 확정/발행 흐름과 분리(안전).
//    불러온 뒤 관리자가 수량·단가를 고칠 수 있고, 발행 시 총액에 그대로 합산된다.
const WEEKLY_CAT = "WEEKLY";

// ── 용달 발송 — 계산서에 단일 품목(category=DELIVERY)으로 붙는다. 재고와 무관(TOOL 아님), 총액에 합산.
//    토글 ON 시 용차비용 1줄 + '확정'. WEEKLY 처럼 일반 카테고리 확정/발행 흐름과 분리(안전).
const DELIVERY_CAT = "DELIVERY";
const DELIVERY_NAME = "용달 발송";

type WeeklyRaw = { name?: string; qty?: string; unitPrice?: string; unit?: string };
function cleanWeeklyItems(
  raw: WeeklyRaw[],
): { name: string; qty: number; unitPrice: number; amount: number; unit: string }[] {
  const out: { name: string; qty: number; unitPrice: number; amount: number; unit: string }[] = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const name = String(r.name ?? "").trim().slice(0, 100);
    const qty = parseQtyStrict(String(r.qty ?? "").trim());
    const unitPrice = parsePriceStrict(String(r.unitPrice ?? "").trim());
    if (!name || qty == null || unitPrice == null) continue; // 자동저장이라 잘못된 줄은 조용히 건너뜀
    out.push({
      name,
      qty,
      unitPrice,
      amount: Math.round(qty * unitPrice),
      unit: String(r.unit ?? "").trim().slice(0, 8),
    });
  }
  return out;
}

async function recomputeInvoiceTotal(tx: Prisma.TransactionClient, invoiceId: string) {
  const all = await tx.invoiceItem.findMany({
    where: { invoiceId },
    select: { amount: true },
  });
  await tx.invoice.update({
    where: { id: invoiceId },
    data: { total: all.reduce((n, it) => n + it.amount, 0) },
  });
}

// 동시작성 실시간 반영(폴링) — 이 계산서 초안의 현재 확정 카테고리 + 품목(주간 제외)을 돌려준다.
// 다른 현장/폰이 확정한 카테고리를 관찰자 화면에 자동 반영하기 위한 읽기 전용 조회.
export async function getInvoiceSyncAction(invoiceId: string): Promise<{
  ok: boolean;
  gone?: boolean;
  status?: string;
  confirmedCats?: string;
  items?: {
    category: string;
    name: string;
    qty: string;
    unitPrice: string;
    inventoryItemId: string;
  }[];
}> {
  await requireAdmin();
  const id = String(invoiceId ?? "");
  if (!id) return { ok: false };
  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!inv) return { ok: true, gone: true };
  return {
    ok: true,
    status: inv.status,
    confirmedCats: inv.confirmedCats,
    items: inv.items
      .filter((it) => it.category !== "WEEKLY")
      .map((it) => ({
        category: it.category,
        name: it.name,
        qty: String(it.qty),
        unitPrice: String(it.unitPrice),
        inventoryItemId: it.inventoryItemId,
      })),
  };
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
      include: { items: { select: { amount: true, category: true } } },
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
    // 용달 발송이 계산서에 들어 있으면 반드시 확정돼야 발행 — 서버가 권위(클라이언트 allCats 우회 차단).
    // 수정(unconfirm)으로 잠금만 풀린 채 남은 용차비용이 다른 편집자에 의해 미승인 발행되는 것을 막는다.
    if (inv.items.some((it) => it.category === DELIVERY_CAT) && !dbConfirmed.has(DELIVERY_CAT)) {
      return { error: "용달 발송을 확정해 주세요." };
    }
    // 주간발주 합산분이 들어 있으면 반드시 확정돼야 발행 — 일반 카테고리와 동일 게이트(서버 권위).
    if (inv.items.some((it) => it.category === WEEKLY_CAT) && !dbConfirmed.has(WEEKLY_CAT)) {
      return { error: "주간발주를 확정해 주세요." };
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
    // 계산서 = 실제 출고 기준 재고 차감 — 발행 시 이 계산서의 공구 품목만큼 기준재고 차감(멱등).
    // (발주 마감 8시 자동차감은 폐지 — 계산서가 유일 소스.) 실패해도 발행은 유지(멱등이라 재고정산에서 보정 가능).
    try {
      await deductInvoiceStock(invoiceId);
    } catch (e) {
      logError("invoice.issue.deductStock", e, { invoiceId });
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

  // 동시작성 데이터 유실 방지 — invoiceId가 없어도(각자 빈 폼으로 시작) 같은 점포·날짜의 작성중(DRAFT)
  // 계산서가 이미 있으면 새로 만들지 않고 '그 하나'에 병합한다. 두 사람이 서로 다른 폰/PC에서
  // 과일/야채·공구/채움채를 나눠 확정해도 한 계산서에 모여, 발행 시 전원 데이터가 담긴다.
  const existing = invoiceId
    ? await prisma.invoice.findUnique({ where: { id: invoiceId } })
    : await prisma.invoice.findFirst({
        where: { userId, date, kind: "DAILY", status: "DRAFT" },
        orderBy: { createdAt: "asc" }, // 여러 개면 가장 먼저 만들어진 것으로 일관되게 수렴
      });
  if (existing && existing.status !== "DRAFT") {
    return { error: "발행된 계산서는 수정할 수 없어요. 취소 후 다시 작성해 주세요." };
  }

  // ── 주간발주(WEEKLY) 확정 — 확정 요청에 '현재 주간발주 품목'을 함께 실어(weekly) 같은 트랜잭션에서 원자적으로 재작성.
  //    (자동저장 디바운스가 확정 클릭으로 취소돼 마지막 편집이 유실되던 버그 차단 — 용달 발송과 동일한 원자 패턴.)
  //    실제 품목이 있을 때만 확정 성립(빈 토큰 방지). 수정(해제)=품목 유지·토큰만 제거.
  const isWeeklyConfirm = confirmCat === WEEKLY_CAT;
  let weeklyConfirmItems: {
    name: string;
    qty: number;
    unitPrice: number;
    amount: number;
    unit: string;
  }[] = [];
  if (isWeeklyConfirm && confirmOn) {
    let wraw: WeeklyRaw[] = [];
    try {
      wraw = JSON.parse(String(formData.get("weekly") ?? "[]"));
    } catch {
      wraw = [];
    }
    weeklyConfirmItems = cleanWeeklyItems(Array.isArray(wraw) ? wraw : []);
  }
  // 확정은 대상 계산서(existing)가 있고 실제 품목이 실렸을 때만 성립.
  const weeklyHasItems = isWeeklyConfirm && !!existing && weeklyConfirmItems.length > 0;

  // ── 용달 발송(DELIVERY) 파라미터 — 토큰과 품목을 '같은 트랜잭션'에서 원자적으로 처리(분리 금지). ──
  const isDelivery = confirmCat === DELIVERY_CAT;
  const deliveryFee = parsePriceStrict(String(formData.get("deliveryFee") ?? "")) ?? 0;
  const deliveryOff = String(formData.get("deliveryOff") ?? "") === "1";
  // 용달 '확정'은 유효한 용차비용이 있어야만 성립 — 그때만 토큰을 켜고 품목을 쓴다(토큰만 남는 유령 방지, #10).
  const deliveryConfirm = isDelivery && confirmOn && !deliveryOff && deliveryFee > 0;

  // confirmedCats 델타 — DB값 기준으로 확정이면 추가, 수정(해제)이면 삭제(폼 전체로 덮지 않음).
  const confSet = new Set(
    String(existing?.confirmedCats ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  if (CATEGORY_ORDER.includes(confirmCat as Category)) {
    if (confirmOn) confSet.add(confirmCat);
    else confSet.delete(confirmCat);
  } else if (isDelivery) {
    if (deliveryConfirm) confSet.add(DELIVERY_CAT);
    else confSet.delete(DELIVERY_CAT); // 수정(unconfirm)·토글오프·무효금액 → 토큰 해제
  } else if (isWeeklyConfirm) {
    if (confirmOn && weeklyHasItems) confSet.add(WEEKLY_CAT);
    else confSet.delete(WEEKLY_CAT); // 수정(해제)·품목없음 → 토큰 해제
  }
  const newConfirmed = [...confSet].join(",");

  // 용달 품목을 트랜잭션 안에서 적용 — 확정=현재 fee로 재작성, 토글오프/무효=삭제, 수정(unconfirm)=유지.
  const applyDeliveryTx = async (tx: Prisma.TransactionClient, invId: string) => {
    if (!isDelivery) return;
    if (deliveryOff || confirmOn) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: invId, category: DELIVERY_CAT } });
      if (deliveryConfirm) {
        await tx.invoiceItem.create({
          data: {
            invoiceId: invId,
            category: DELIVERY_CAT,
            name: DELIVERY_NAME,
            qty: 1,
            unitPrice: deliveryFee,
            amount: deliveryFee,
            sortOrder: -1,
          },
        });
      }
    }
  };

  // 주간발주 확정 시 '함께 전송된 현재 품목'을 같은 트랜잭션에서 재작성 — 확정 클릭이 자동저장 디바운스를
  // 취소해도 마지막 편집이 유실되지 않게(용달과 동일한 토큰-품목 원자성). 수정(unconfirm)=품목 유지.
  const applyWeeklyConfirmTx = async (tx: Prisma.TransactionClient, invId: string) => {
    if (!weeklyHasItems) return; // isWeeklyConfirm && confirmOn && 품목 있음일 때만
    await tx.invoiceItem.deleteMany({ where: { invoiceId: invId, category: WEEKLY_CAT } });
    await tx.invoiceItem.createMany({
      data: weeklyConfirmItems.map((it, i) => ({
        invoiceId: invId,
        category: WEEKLY_CAT,
        sortOrder: i,
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
        amount: it.amount,
        unit: it.unit,
      })),
    });
  };

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
        await applyDeliveryTx(tx, existing.id); // 용달 품목도 같은 트랜잭션에서(토큰-품목 원자성, #1)
        await applyWeeklyConfirmTx(tx, existing.id); // 주간발주 확정 품목도 원자적으로(디바운스 취소 유실 방지)
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
      // 새 계산서 — 첫 확정. 제출된 품목 + (있으면) 용달 품목을 한 번에 생성(토큰-품목 원자성, #1).
      const createItems: {
        category: string;
        name: string;
        qty: number;
        unitPrice: number;
        amount: number;
        inventoryItemId: string;
        sortOrder: number;
      }[] = items.map((it, i) => ({ ...it, sortOrder: i }));
      if (deliveryConfirm) {
        createItems.push({
          category: DELIVERY_CAT,
          name: DELIVERY_NAME,
          qty: 1,
          unitPrice: deliveryFee,
          amount: deliveryFee,
          inventoryItemId: "",
          sortOrder: -1,
        });
      }
      const total = createItems.reduce((n, it) => n + it.amount, 0);
      const created = await prisma.invoice.create({
        data: {
          userId,
          date,
          total,
          status: "DRAFT",
          confirmedCats: newConfirmed,
          items: { create: createItems },
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

// 계산서 '불러오기' — 그 출고일(shipmentDate)에 청구할 해당 카테고리 품목을 한 번에 로드.
//  ① 재고현황 '담기' 발주(category Order) — 출고일 기준 발주범위(orderRangeForShipment). 공급가는 재고현황 이름매칭.
//  ② 예약(재고연동+수기) 확정분 — 픽업일 == 출고일(사용자 규칙). 공급가는 예약 스냅샷. ※예약은 공구 전용 개념이라 TOOL만.
// 같은 품목명은 수량 합산. 공급가는 처음 잡힌 값(없으면 빈칸 → 관리자가 채움). 계산서 해당 칸에 그대로 채운다.
export async function loadInvoiceToolItemsAction(
  userId: string,
  shipmentDate: string,
  category: Category = "TOOL",
): Promise<{
  items: { name: string; qty: string; unitPrice: string; inventoryItemId: string }[];
}> {
  await requireAdmin();
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(shipmentDate)) return { items: [] };

  const { start, end } = orderRangeForShipment(shipmentDate);
  const [toolOrders, resvItems, invItems] = await Promise.all([
    // ① 담기 발주(해당 카테고리) — 출고일에 실릴 발주(전날 등). 취소 제외.
    prisma.order.findMany({
      where: {
        userId,
        category,
        status: { not: "CANCELLED" },
        createdAt: { gte: start, lt: end },
      },
      select: {
        items: {
          select: { name: true, rawName: true, qty: true, rawQty: true },
          orderBy: { sortOrder: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    // ② 예약 확정분 — 픽업일==출고일(연동·수기 모두). 공구 전용(예약엔 카테고리 없음)이라 TOOL일 때만.
    category === "TOOL"
      ? prisma.reservationOrderItem.findMany({
          where: {
            pickupDate: shipmentDate,
            qty: { gt: 0 },
            order: { userId, batch: { active: true } }, OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
          },
          select: { name: true, qty: true, supplyPrice: true, inventoryItemId: true },
          orderBy: { sortOrder: "asc" },
        })
      : Promise.resolve(
          [] as { name: string; qty: number; supplyPrice: number; inventoryItemId: string }[],
        ),
    // 공급가·연동 id 이름매칭용(담기 품목엔 가격·연동이 없어 재고현황에서 가져온다)
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, supplyPrice: true },
    }),
  ]);

  const priceByName = new Map<string, number>();
  const idByName = new Map<string, string>();
  for (const it of invItems) {
    const k = it.name.trim();
    if (k && !priceByName.has(k)) priceByName.set(k, it.supplyPrice);
    if (k && !idByName.has(k)) idByName.set(k, it.id);
  }

  const qtyToNum = (v: string | number): number => {
    if (typeof v === "number") return v;
    const n = parseFloat(String(v).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) ? n : 0;
  };

  type Agg = { name: string; qty: number; unitPrice: number; priced: boolean; inventoryItemId: string };
  const orderKeys: string[] = [];
  const agg = new Map<string, Agg>();
  const add = (name: string, qty: number, price: number | null, invId: string) => {
    const key = name.trim();
    if (!key || qty <= 0) return;
    let a = agg.get(key);
    if (!a) {
      a = { name: key, qty: 0, unitPrice: 0, priced: false, inventoryItemId: "" };
      agg.set(key, a);
      orderKeys.push(key);
    }
    a.qty += qty;
    if (!a.priced && price != null && price > 0) {
      a.unitPrice = price;
      a.priced = true;
    }
    if (!a.inventoryItemId && invId) a.inventoryItemId = invId;
  };

  // ① 담기 발주(공구) — 공급가·연동 id는 재고현황 이름매칭
  for (const o of toolOrders) {
    for (const it of o.items) {
      const nm = (it.name || it.rawName || "").trim();
      add(nm, qtyToNum(it.qty || it.rawQty), priceByName.get(nm) ?? null, idByName.get(nm) ?? "");
    }
  }
  // ② 예약 확정분(픽업==출고일) — 공급가는 예약 스냅샷, 연동 id는 예약 스냅샷 우선(없으면 이름매칭)
  for (const it of resvItems) {
    add(it.name, qtyToNum(it.qty), it.supplyPrice, it.inventoryItemId || idByName.get(it.name.trim()) || "");
  }

  const items = orderKeys.map((k) => {
    const a = agg.get(k)!;
    const qty = Math.round(a.qty * 100) / 100; // 부동소수 정리
    return {
      name: a.name,
      qty: String(qty),
      unitPrice: a.priced ? String(a.unitPrice) : "",
      inventoryItemId: a.inventoryItemId,
    };
  });
  return { items };
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
    select: {
      userId: true,
      date: true,
      status: true,
      kind: true,
      total: true, // 수정 전 결제요청(미수) 금액 — 수정 내역에 before로 기록
      items: {
        // 수정 전 품목 스냅샷 — 아래에서 수정 후와 비교해 추가/변경/제거 내역 생성
        select: { category: true, name: true, qty: true, unitPrice: true, amount: true },
      },
    },
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

  // 수정 전 공구 품목 스냅샷 — 아래 재고 재조정(차이만큼)에 사용.
  const oldTool = await invoiceToolByName(invoiceId);

  try {
    await prisma.$transaction(async (tx) => {
      // 상태 가드를 쓰기 자체에 — 수정 도중 입금확인/취소로 전이되면 count 0 → 중단(레이스 차단).
      const upd = await tx.invoice.updateMany({
        where: { id: invoiceId, status: "ISSUED" },
        data: { revisedAt: new Date() },
      });
      if (upd.count === 0) throw new Error("INVOICE_NOT_ISSUED");
      // 일반 품목만 통째 교체(제출된 payload가 최종본) — 주간발주 합산분(WEEKLY)·용달 발송(DELIVERY)은 보존.
      await tx.invoiceItem.deleteMany({
        where: { invoiceId, category: { notIn: [WEEKLY_CAT, DELIVERY_CAT] } },
      });
      await tx.invoiceItem.createMany({
        data: items.map((it, i) => ({ ...it, sortOrder: i, invoiceId })),
      });
      // 총액은 주간발주 합산분까지 포함해 재계산.
      await recomputeInvoiceTotal(tx, invoiceId);
    });
  } catch (err) {
    if ((err as Error)?.message === "INVOICE_NOT_ISSUED") {
      return { error: "입금대기 중인 계산서만 수정할 수 있어요. (이미 입금확인/취소됨)" };
    }
    console.error("[invoice] revise failed:", err);
    return { error: "수정에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // 재고 재조정 — 이미 차감된 계산서면 '차이만큼'만 반영, (발행 때 차감 실패 등으로) 미차감이면 전량 차감.
  try {
    const stDed = (
      await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { stockDeductedAt: true },
      })
    )?.stockDeductedAt;
    if (stDed) await applyInvoiceStockDelta(invoiceId, oldTool);
    else await deductInvoiceStock(invoiceId);
  } catch (e) {
    logError("invoice.revise.adjustStock", e, { invoiceId });
  }

  // 최종 총액(주간발주 합산분 포함) — 감사/알림에 사용.
  const finalTotal =
    (
      await prisma.invoice.findUnique({
        where: { id: invoiceId },
        select: { total: true },
      })
    )?.total ?? 0;

  // ── 수정 내역 스냅샷 — 이번 재발송 시점에 무엇이 추가/변경/제거됐는지 + 결제요청(미수) 금액 변화 기록. ──
  //    (점주·관리자 공통 열람. 변경이 하나도 없으면 남기지 않는다.)
  try {
    const afterItems = await prisma.invoiceItem.findMany({
      where: { invoiceId },
      select: { category: true, name: true, qty: true, unitPrice: true, amount: true },
    });
    const changes = diffInvoiceItems(inv.items, afterItems);
    if (changes.length > 0 || inv.total !== finalTotal) {
      await prisma.invoiceRevision.create({
        data: {
          invoiceId,
          totalBefore: inv.total,
          totalAfter: finalTotal,
          changes: JSON.stringify(changes),
        },
      });
    }
  } catch (e) {
    logError("invoice.revise.history", e, { invoiceId });
  }

  await writeAudit({
    action: "invoice.revise",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "invoice",
    targetId: invoiceId,
    summary: `계산서 수정·재발송 · ${inv.date} · ${finalTotal.toLocaleString("ko-KR")}원`,
  });
  // 점주에게 '계산서가 수정되었습니다 + 바뀐 금액' 재발송(같은 계산서로 이동).
  await notifyMerchantInvoiceRevised(inv.userId, invoiceId, finalTotal);
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
  // 계산서 취소 → 발행 때 차감했던 공구 재고 복구 + 예약 차감표시 되돌림(멱등).
  try {
    await restoreInvoiceStock(id);
  } catch (e) {
    logError("invoice.void.restoreStock", e, { invoiceId: id });
  }
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

// ── 주간발주 토글 ON — 그 출고일(date=출고 기준일)의 확정 주간발주를 이 계산서에 합산분(WEEKLY)으로 불러온다.
//    출고일이 주간발주 출고 요일(기본 수)이 아니거나 확정 주간발주가 없으면 아무것도 안 함.
export async function loadWeeklyIntoInvoiceAction(formData: FormData) {
  await requireAdmin();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  const userId = String(formData.get("userId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!userId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  const merchant = await prisma.user.findUnique({ where: { id: userId } });
  if (!merchant || !isMerchant(merchant.role as Role)) return;

  // 발주 확인 전이라도 불러오기 허용(requireConfirmed:false).
  const weekly = await getWeeklyItemsForStoreShipment(userId, date, {
    requireConfirmed: false,
  });
  if (weekly.length === 0) return;

  // 불러오는 순간 그 주간발주를 자동 '발주 확인' 처리 — 발주서(출고 sheet, 확정분만 표시)에도 함께 실리도록.
  // 카테고리별 출고요일이 달라도 그 주 토요일 사이클을 가리키는 any-day 매핑 사용.
  const weekKey = weeklyKeyForAnyShipmentDay(date);
  if (weekKey) {
    await prisma.weeklyOrder.updateMany({
      where: { userId, weekKey, confirmed: false },
      data: { confirmed: true, confirmedAt: new Date() },
    });
    revalidatePath("/admin/weekly");
    revalidatePath(`/admin/weekly/${userId}`);
  }

  // 대상 DRAFT 계산서 확보 — 없으면 생성.
  let id = invoiceId;
  const existing = id
    ? await prisma.invoice.findUnique({ where: { id } })
    : await prisma.invoice.findFirst({
        where: { userId, date, status: "DRAFT" },
        orderBy: { updatedAt: "desc" },
      });
  if (existing) {
    if (existing.status !== "DRAFT") return;
    id = existing.id;
  } else {
    const created = await prisma.invoice.create({
      data: { userId, date, status: "DRAFT" },
    });
    id = created.id;
  }

  await prisma.$transaction(async (tx) => {
    await tx.invoiceItem.deleteMany({ where: { invoiceId: id, category: WEEKLY_CAT } });
    await tx.invoiceItem.createMany({
      data: weekly.map((w, i) => ({
        invoiceId: id,
        category: WEEKLY_CAT,
        sortOrder: i,
        name: w.name,
        qty: w.qty,
        unitPrice: w.unitPrice,
        amount: w.amount,
        unit: boxWord(w.category),
      })),
    });
    // 새로 불러온 주간발주는 '미확정' 상태에서 시작 — 기존 확정 토큰이 있으면 제거(내용 바뀌었으니 재확정 필요).
    const cur = await tx.invoice.findUnique({ where: { id }, select: { confirmedCats: true } });
    const cats = String(cur?.confirmedCats ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (cats.includes(WEEKLY_CAT)) {
      await tx.invoice.update({
        where: { id },
        data: { confirmedCats: cats.filter((c) => c !== WEEKLY_CAT).join(",") },
      });
    }
    await recomputeInvoiceTotal(tx, id);
  });
  revalidatePath(`/admin/invoices/${id}`);
  redirect(`/admin/invoices/${id}`);
}

// ── 주간발주 합산분 수정 저장(자동저장) — 관리자가 불러온 주간발주 품목/수량/단가를 고칠 때.
export async function saveWeeklyItemsAction(
  _prev: InvoiceFormState,
  formData: FormData,
): Promise<InvoiceFormState> {
  await requireAdmin();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return { error: "계산서를 먼저 만들어 주세요." };
  let raw: WeeklyRaw[] = [];
  try {
    raw = JSON.parse(String(formData.get("weekly") ?? "[]"));
  } catch {
    raw = [];
  }
  const items = cleanWeeklyItems(Array.isArray(raw) ? raw : []);
  try {
    await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.findUnique({
        where: { id: invoiceId },
        select: { status: true, confirmedCats: true },
      });
      if (!inv || inv.status !== "DRAFT") throw new Error("NOT_DRAFT");
      // 주간발주가 확정(잠금)된 상태면 자동저장 거부 — '수정'으로 잠금 해제 후에만 편집(확정분 무단 변경 차단).
      if (
        String(inv.confirmedCats ?? "")
          .split(",")
          .map((s) => s.trim())
          .includes(WEEKLY_CAT)
      )
        throw new Error("WEEKLY_LOCKED");
      await tx.invoiceItem.deleteMany({ where: { invoiceId, category: WEEKLY_CAT } });
      if (items.length > 0) {
        await tx.invoiceItem.createMany({
          data: items.map((it, i) => ({
            invoiceId,
            category: WEEKLY_CAT,
            sortOrder: i,
            name: it.name,
            qty: it.qty,
            unitPrice: it.unitPrice,
            amount: it.amount,
            unit: it.unit,
          })),
        });
      }
      await recomputeInvoiceTotal(tx, invoiceId);
    });
  } catch (e) {
    if ((e as Error)?.message === "NOT_DRAFT") {
      return { error: "발행된 계산서는 수정할 수 없어요." };
    }
    if ((e as Error)?.message === "WEEKLY_LOCKED") {
      return { error: "주간발주가 확정됨 — '수정'을 눌러 잠금을 해제한 뒤 편집해 주세요." };
    }
    return { error: "저장에 실패했어요." };
  }
  revalidatePath(`/admin/invoices/${invoiceId}`);
  return {};
}

// ── 주간발주 토글 OFF — 이 계산서에서 주간발주 합산분을 뺀다.
export async function clearWeeklyFromInvoiceAction(formData: FormData) {
  await requireAdmin();
  const invoiceId = String(formData.get("invoiceId") ?? "");
  if (!invoiceId) return;
  await prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUnique({
      where: { id: invoiceId },
      select: { status: true, confirmedCats: true },
    });
    if (!inv || inv.status !== "DRAFT") return;
    await tx.invoiceItem.deleteMany({ where: { invoiceId, category: WEEKLY_CAT } });
    // 주간발주를 빼면 확정 토큰도 제거(빈 확정 토큰이 남아 발행 게이트를 오작동시키지 않게).
    const cats = String(inv.confirmedCats ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    if (cats.includes(WEEKLY_CAT)) {
      await tx.invoice.update({
        where: { id: invoiceId },
        data: { confirmedCats: cats.filter((c) => c !== WEEKLY_CAT).join(",") },
      });
    }
    await recomputeInvoiceTotal(tx, invoiceId);
  });
  revalidatePath(`/admin/invoices/${invoiceId}`);
  redirect(`/admin/invoices/${invoiceId}`);
}
