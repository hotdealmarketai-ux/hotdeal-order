"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday } from "@/lib/date";
import { deductInvoiceStock } from "@/lib/invoice-stock";
import { setInventoryPushPending } from "@/lib/inventory-sheet";
import { writeAudit } from "@/lib/audit";

// 재고 마감 = '계산서(실제 출고) 기준' 공구 차감 내역. 차감은 계산서 발행 시 자동으로 일어난다(deductInvoiceStock).
// 이 페이지는 그 출고일 발행 계산서의 공구 '총 출고량(=총 차감량)'을 품목별로 모아 보여주고,
//  ① 관리자가 품목별로 수량을 수정하면 그 차이만큼 base 재조정(멱등, DailyStockAdjustment로 추적),
//  ② 계산서엔 있는데 재고현황에 없어(이름 불일치·미등록) 차감 못 한 품목을 따로 필터링해 보여준다.
export type ReconcileRow = {
  name: string;
  deducted: number; // 출고량(=차감 총량). 수동 조정값이 있으면 그 값, 없으면 계산서 발행 총합.
  invoiceTotal: number; // 계산서 발행 총합(참고)
  base: number; // 현재 실재고(차감 반영 후)
  adjusted: boolean; // 수동 조정됨
};

const validDate = (d?: string) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : kstToday();

// 그 출고일에 발행(ISSUED/PAID)된 DAILY 계산서 + 공구 품목 + 차감여부.
async function issuedInvoicesForDate(date: string) {
  return prisma.invoice.findMany({
    where: { date, kind: "DAILY", status: { in: ["ISSUED", "PAID"] } },
    select: {
      id: true,
      stockDeductedAt: true,
      items: { where: { category: "TOOL" }, select: { name: true, qty: true } },
    },
  });
}

// 계산서 공구 품목을 품목명별 총합(정수)으로.
function toolTotalsByName(
  invoices: { items: { name: string; qty: number }[] }[],
): Map<string, number> {
  const m = new Map<string, number>();
  for (const inv of invoices)
    for (const it of inv.items) {
      const name = it.name.trim();
      const q = Math.round(it.qty);
      if (name && q > 0) m.set(name, (m.get(name) ?? 0) + q);
    }
  return m;
}

export async function computeToolReconcile(shipDate?: string): Promise<{
  date: string;
  matched: ReconcileRow[]; // 재고현황에 있는(차감된) 품목 — 수량 조정 가능
  unmatched: { name: string; invoiceTotal: number }[]; // 재고현황에 없어 차감 안 된 품목
  invoiceCount: number; // 공구 있는 발행 계산서 수
  undeductedCount: number; // 아직 재고 미반영(발행 시 차감 실패) 계산서 수
}> {
  await requireAdmin();
  const date = validDate(shipDate);
  const invoices = await issuedInvoicesForDate(date);
  const byName = toolTotalsByName(invoices);
  const names = [...byName.keys()];

  const [items, adjustments] = await Promise.all([
    names.length
      ? prisma.inventoryItem.findMany({
          where: { name: { in: names }, deletedAt: null },
          select: { name: true, qty: true },
        })
      : Promise.resolve([] as { name: string; qty: number }[]),
    names.length
      ? prisma.dailyStockAdjustment.findMany({ where: { date, itemName: { in: names } } })
      : Promise.resolve([] as { itemName: string; correction: number }[]),
  ]);
  const baseByName = new Map<string, number>();
  for (const it of items) baseByName.set(it.name, (baseByName.get(it.name) ?? 0) + it.qty);
  // 보정치(correction) — 표시 출고량 = 계산서총합 − correction. 계산서 추가발행/취소돼도 어긋나지 않음.
  const corrByName = new Map(adjustments.map((a) => [a.itemName, a.correction]));

  const matched: ReconcileRow[] = [];
  const unmatched: { name: string; invoiceTotal: number }[] = [];
  for (const name of names.sort((a, b) => a.localeCompare(b, "ko"))) {
    const invoiceTotal = byName.get(name)!;
    if (baseByName.has(name)) {
      const corr = corrByName.get(name);
      const deducted = corr !== undefined ? invoiceTotal - corr : invoiceTotal;
      matched.push({
        name,
        invoiceTotal,
        deducted,
        base: baseByName.get(name)!,
        adjusted: deducted !== invoiceTotal,
      });
    } else {
      unmatched.push({ name, invoiceTotal });
    }
  }
  const withTool = invoices.filter((i) => i.items.length > 0);
  const undeductedCount = withTool.filter((i) => !i.stockDeductedAt).length;
  return { date, matched, unmatched, invoiceCount: withTool.length, undeductedCount };
}

// 재고 마감 적용 — ① 미차감 발행 계산서 먼저 반영(멱등, base 정합) ② 관리자 수량 조정을 '차이만큼' base 재조정.
// 조정은 멱등: prev(=기존 조정값 or 계산서 총합) → new 로 갈 때 base += (prev − new). 재적용해도 이중 안 됨.
export async function applyToolReconcileAdjusted(
  shipDate: string | undefined,
  edits?: { name: string; qty: number }[],
): Promise<{ ok: boolean; count: number }> {
  const admin = await requireAdmin();
  const date = validDate(shipDate);
  const invoices = await issuedInvoicesForDate(date);

  // ① 미차감분 반영(발행 때 차감 실패한 계산서) — 멱등. base가 계산서 총합을 정확히 반영하게.
  for (const inv of invoices)
    if (!inv.stockDeductedAt && inv.items.length > 0) await deductInvoiceStock(inv.id);

  // ② 수동 수량(출고량) 조정 — 보정치(correction) 기준으로 멱등 재조정.
  //    표시 출고량 = I − prevC. 관리자가 target으로 바꾸면 base += (currentEffective − target), correction := I − target.
  //    target은 '오늘 차감 전 재고(base + currentEffective)'로 캡 → base가 0으로 클램프되며 정보 손실되는 일 없음.
  const byName = toolTotalsByName(invoices);
  const existing = await prisma.dailyStockAdjustment.findMany({ where: { date } });
  const corrMap = new Map(existing.map((a) => [a.itemName, a.correction]));
  let count = 0;
  const changed: { name: string; qty: number }[] = [];
  for (const e of edits ?? []) {
    const name = String(e?.name ?? "").trim();
    let target = Math.max(0, Math.floor(Number(e?.qty) || 0));
    if (!name) continue;
    const invoiceTotal = byName.get(name) ?? 0; // I
    if (invoiceTotal <= 0) continue; // 이 출고일 계산서에 없는 품목은 조정 대상 아님
    const item = await prisma.inventoryItem.findFirst({
      where: { name, deletedAt: null },
      select: { qty: true },
    });
    if (!item) continue; // 재고현황에 없으면 조정 안 함(차감 대상 아님)
    const prevC = corrMap.get(name) ?? 0;
    const currentEffective = invoiceTotal - prevC; // 현재 반영된 출고량
    const cap = item.qty + currentEffective; // 오늘 차감 전 재고
    if (target > cap) target = cap; // 있던 것보다 많이 뺄 순 없음(음수 재고 방지)
    if (target === currentEffective) continue; // 변화 없음
    const delta = currentEffective - target; // base += delta (줄이면 +복구, 늘리면 −추가차감)
    const newC = invoiceTotal - target; // 보정치 갱신
    await prisma.$transaction([
      prisma.$executeRaw`UPDATE "InventoryItem" SET qty = GREATEST(0, qty + ${delta}) WHERE name = ${name} AND "deletedAt" IS NULL`,
      prisma.dailyStockAdjustment.upsert({
        where: { date_itemName: { date, itemName: name } },
        create: { date, itemName: name, correction: newC },
        update: { correction: newC },
      }),
    ]);
    count++;
    changed.push({ name, qty: target });
  }

  if (count > 0) {
    await setInventoryPushPending().catch(() => {});
    await writeAudit({
      action: "stock.reconcileAdjust",
      actorId: admin.id,
      actorName: admin.storeName,
      summary: `${date} 재고 마감 수량 조정 — ${count}품목`,
      snapshot: changed,
    }).catch(() => {});
  }
  revalidatePath("/admin/stock-reconcile");
  revalidatePath("/admin/inventory");
  return { ok: true, count };
}
