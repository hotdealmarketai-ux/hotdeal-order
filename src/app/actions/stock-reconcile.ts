"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, orderRangeForShipment } from "@/lib/date";
import { deductToolOrders } from "@/lib/stock-hold";
import { writeAudit } from "@/lib/audit";

// 공구(상시) 발주분 재고 정산 — 미리보기/적용. 예약분은 픽업일 10시 자동차감이라 여기 포함 안 함(중복 방지).
export type ReconcileRow = {
  name: string;
  ordered: number; // 그 출고일 확정 공구발주 합계(미차감분만)
  base: number; // 현재 실재고
  proposed: number; // 제안 실재고 = max(0, base − ordered)
  matched: boolean; // 재고현황에 같은 이름 품목이 있는지
};

const validDate = (d?: string) =>
  d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : kstToday();

async function toolOrdersForShipment(date: string) {
  const { start, end } = orderRangeForShipment(date);
  return prisma.order.findMany({
    where: {
      category: "TOOL",
      status: { not: "CANCELLED" },
      stockDeductedAt: null, // 아직 차감 안 된 발주만
      createdAt: { gte: start, lt: end },
    },
    select: { id: true, items: { select: { name: true, qty: true } } },
  });
}

export async function computeToolReconcile(
  shipDate?: string,
): Promise<{ date: string; rows: ReconcileRow[]; orderCount: number }> {
  await requireAdmin();
  const date = validDate(shipDate);
  const orders = await toolOrdersForShipment(date);

  const byName = new Map<string, number>();
  for (const o of orders)
    for (const it of o.items) {
      const name = it.name.trim();
      const n = parseInt(String(it.qty).replace(/[^\d]/g, ""), 10);
      if (name && Number.isFinite(n) && n > 0)
        byName.set(name, (byName.get(name) ?? 0) + n);
    }

  const names = [...byName.keys()];
  const items = names.length
    ? await prisma.inventoryItem.findMany({
        where: { name: { in: names }, deletedAt: null },
        select: { name: true, qty: true },
      })
    : [];
  const baseByName = new Map<string, number>();
  for (const it of items)
    baseByName.set(it.name, (baseByName.get(it.name) ?? 0) + it.qty);

  const rows: ReconcileRow[] = [...byName.entries()]
    .map(([name, ordered]) => {
      const matched = baseByName.has(name);
      const base = baseByName.get(name) ?? 0;
      return { name, ordered, base, proposed: Math.max(0, base - ordered), matched };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return { date, rows, orderCount: orders.length };
}

// 관리자가 차감량을 '수정'해서 적용(추가 불출 등 실제 나간 만큼). adjustments: [{name, qty}].
// 실제 차감은 넘어온 수정값 기준(발주합계와 달라도 됨). 해당 출고일 공구 발주는 stockDeductedAt로 표시(재정산 방지).
export async function applyToolReconcileAdjusted(
  shipDate: string | undefined,
  adjustments: { name: string; qty: number }[],
): Promise<{ ok: boolean; count: number }> {
  const admin = await requireAdmin();
  const date = validDate(shipDate);
  const orders = await toolOrdersForShipment(date);
  if (orders.length === 0) return { ok: true, count: 0 };

  // 검증 — 이름 트림, 수량 0 이상 정수. 같은 이름 여러 행이면 합산.
  const byName = new Map<string, number>();
  for (const a of adjustments ?? []) {
    const name = String(a?.name ?? "").trim();
    const qty = Math.max(0, Math.floor(Number(a?.qty) || 0));
    if (name && qty > 0) byName.set(name, (byName.get(name) ?? 0) + qty);
  }
  const now = new Date();
  await prisma.$transaction([
    // GREATEST(0, …): 실물이 재고보다 많이 나가도 음수 저장 방지(차이는 수기 보정).
    ...[...byName.entries()].map(
      ([name, q]) =>
        prisma.$executeRaw`UPDATE "InventoryItem" SET qty = GREATEST(0, qty - ${q}) WHERE name = ${name} AND "deletedAt" IS NULL`,
    ),
    prisma.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { stockDeductedAt: now },
    }),
  ]);
  await writeAudit({
    action: "stock.reconcileTool",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `${date} 공구 재고 정산(수정 차감) — ${byName.size}품목, 발주 ${orders.length}건`,
    snapshot: [...byName.entries()].map(([name, qty]) => ({ name, qty })),
  }).catch(() => {});
  revalidatePath("/admin/stock-reconcile");
  revalidatePath("/admin/inventory");
  return { ok: true, count: orders.length };
}
