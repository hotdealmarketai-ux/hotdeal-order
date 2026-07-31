"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday } from "@/lib/date";
import { deductInvoiceStock } from "@/lib/invoice-stock";
import { writeAudit } from "@/lib/audit";

// 재고 정산 = '계산서(실제 출고) 기준' 공구 차감 내역. 재고 차감은 계산서 발행 시 자동으로 일어나며(deductInvoiceStock),
// 이 페이지는 그 출고일에 발행된 계산서의 공구 품목·차감 결과를 보여주고, 혹시 미차감분이 있으면 '재고 반영'으로 보정한다.
// (발주 마감 8시 자동차감은 폐지 — 계산서가 유일 소스.)
export type ReconcileRow = {
  name: string;
  tool: number; // 계산서(발행)에 적힌 공구 수량 = 실제 출고
  resv: number; // (미사용, 계산서에 통합됨) — 항상 0
  ordered: number; // = tool (계산서 기준 차감량)
  base: number; // 현재 실재고(계산서 발행 시 이미 차감 반영됨)
  proposed: number; // 현재 실재고와 동일(이미 차감됨)
  matched: boolean; // 재고현황에 같은 이름 품목이 있는지
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

export async function computeToolReconcile(shipDate?: string): Promise<{
  date: string;
  rows: ReconcileRow[];
  orderCount: number; // 그 출고일 공구가 있는 발행 계산서 수
  resvCount: number; // 아직 재고 미반영(차감 안 된) 발행 계산서 수 → '재고 반영' 대상
}> {
  await requireAdmin();
  const date = validDate(shipDate);
  const invoices = await issuedInvoicesForDate(date);

  // 계산서(발행) 공구 품목 — 품목명 합산(정수)
  const toolByName = new Map<string, number>();
  for (const inv of invoices)
    for (const it of inv.items) {
      const name = it.name.trim();
      const q = Math.round(it.qty);
      if (name && q > 0) toolByName.set(name, (toolByName.get(name) ?? 0) + q);
    }

  const names = [...toolByName.keys()];
  const items = names.length
    ? await prisma.inventoryItem.findMany({
        where: { name: { in: names }, deletedAt: null },
        select: { name: true, qty: true },
      })
    : [];
  const baseByName = new Map<string, number>();
  for (const it of items)
    baseByName.set(it.name, (baseByName.get(it.name) ?? 0) + it.qty);

  const rows: ReconcileRow[] = names
    .map((name) => {
      const tool = toolByName.get(name) ?? 0;
      const matched = baseByName.has(name);
      const base = baseByName.get(name) ?? 0;
      // 계산서 발행 시 이미 차감됨 → base가 곧 차감 후 재고. proposed = base(추가 차감 없음).
      return { name, tool, resv: 0, ordered: tool, base, proposed: base, matched };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  const withTool = invoices.filter((i) => i.items.length > 0);
  const undeducted = withTool.filter((i) => !i.stockDeductedAt).length;
  return { date, rows, orderCount: withTool.length, resvCount: undeducted };
}

// '재고 반영' — 그 출고일에 발행된 계산서 중 아직 재고 미차감분을 차감(멱등, 안전망).
// 계산서 발행 시 자동 차감되지만, 혹시 누락된 게 있으면 여기서 보정한다. 이미 차감된 계산서는 건너뜀(이중차감 없음).
// (adjustments 인자는 하위호환용 — 계산서 기준이라 수기 수정은 계산서 수정으로 대신함.)
export async function applyToolReconcileAdjusted(
  shipDate: string | undefined,
  _adjustments?: { name: string; qty: number }[],
): Promise<{ ok: boolean; count: number }> {
  const admin = await requireAdmin();
  const date = validDate(shipDate);
  const invoices = await issuedInvoicesForDate(date);
  const undeducted = invoices.filter((i) => !i.stockDeductedAt && i.items.length > 0);
  let count = 0;
  for (const inv of undeducted) {
    if (await deductInvoiceStock(inv.id)) count++;
  }
  if (count > 0) {
    await writeAudit({
      action: "stock.reconcileTool",
      actorId: admin.id,
      actorName: admin.storeName,
      summary: `${date} 재고 반영(계산서 기준) — 미차감 계산서 ${count}건 차감`,
    }).catch(() => {});
  }
  revalidatePath("/admin/stock-reconcile");
  revalidatePath("/admin/inventory");
  return { ok: true, count };
}
