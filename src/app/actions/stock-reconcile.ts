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
  tool: number; // 공구(상시 담기) 발주 합계
  resv: number; // 예약발주(재고연동) 합계 — 픽업일 = 이 출고일
  ordered: number; // tool + resv (기본 차감량)
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

// 그 출고일(=픽업일)에 나갈 미차감 예약발주(재고연동) 아이템 — 픽업10시 자동차감과 stockDeductedAt 공유(중복 방지).
async function resvItemsForPickup(date: string) {
  return prisma.reservationOrderItem.findMany({
    where: {
      pickupDate: date,
      inventoryItemId: { not: "" },
      qty: { gt: 0 },
      stockDeductedAt: null,
      order: { confirmed: true, batch: { active: true } },
    },
    select: { inventoryItemId: true, qty: true },
  });
}

export async function computeToolReconcile(shipDate?: string): Promise<{
  date: string;
  rows: ReconcileRow[];
  orderCount: number;
  resvCount: number;
}> {
  await requireAdmin();
  const date = validDate(shipDate);
  const [orders, resvItems] = await Promise.all([
    toolOrdersForShipment(date),
    resvItemsForPickup(date),
  ]);

  // 공구(상시) — 품목명 합산
  const toolByName = new Map<string, number>();
  for (const o of orders)
    for (const it of o.items) {
      const name = it.name.trim();
      const n = parseInt(String(it.qty).replace(/[^\d]/g, ""), 10);
      if (name && Number.isFinite(n) && n > 0)
        toolByName.set(name, (toolByName.get(name) ?? 0) + n);
    }

  // 예약(연동) — inventoryItemId 합산 → 품목명으로 변환
  const resvByItemId = new Map<string, number>();
  for (const r of resvItems)
    resvByItemId.set(
      r.inventoryItemId,
      (resvByItemId.get(r.inventoryItemId) ?? 0) + r.qty,
    );
  const resvItemIds = [...resvByItemId.keys()];
  const resvInv = resvItemIds.length
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: resvItemIds } },
        select: { id: true, name: true },
      })
    : [];
  const resvByName = new Map<string, number>();
  for (const inv of resvInv)
    resvByName.set(
      inv.name,
      (resvByName.get(inv.name) ?? 0) + (resvByItemId.get(inv.id) ?? 0),
    );

  const names = [...new Set([...toolByName.keys(), ...resvByName.keys()])];
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
      const resv = resvByName.get(name) ?? 0;
      const ordered = tool + resv;
      const matched = baseByName.has(name);
      const base = baseByName.get(name) ?? 0;
      return { name, tool, resv, ordered, base, proposed: Math.max(0, base - ordered), matched };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  return { date, rows, orderCount: orders.length, resvCount: resvItems.length };
}

// 관리자가 차감량을 '수정'해서 적용(추가 불출 등 실제 나간 만큼). adjustments: [{name, qty}].
// 실제 차감은 넘어온 수정값 기준(발주합계와 달라도 됨). 해당 출고일 공구 발주는 stockDeductedAt로 표시(재정산 방지).
export async function applyToolReconcileAdjusted(
  shipDate: string | undefined,
  adjustments: { name: string; qty: number }[],
): Promise<{ ok: boolean; count: number }> {
  const admin = await requireAdmin();
  const date = validDate(shipDate);
  const [orders, resvItems] = await Promise.all([
    toolOrdersForShipment(date),
    resvItemsForPickup(date),
  ]);
  if (orders.length === 0 && resvItems.length === 0) return { ok: true, count: 0 };

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
    // 공구 발주 표시(재정산 방지)
    prisma.order.updateMany({
      where: { id: { in: orders.map((o) => o.id) } },
      data: { stockDeductedAt: now },
    }),
    // 예약(연동) 아이템도 표시 — 픽업10시 자동차감(deductDuePickupStock)과 stockDeductedAt 공유해 이중차감 방지.
    prisma.reservationOrderItem.updateMany({
      where: {
        pickupDate: date,
        inventoryItemId: { not: "" },
        stockDeductedAt: null,
        order: { confirmed: true, batch: { active: true } },
      },
      data: { stockDeductedAt: now },
    }),
  ]);
  await writeAudit({
    action: "stock.reconcileTool",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `${date} 재고 정산(수정 차감) — ${byName.size}품목 · 공구 ${orders.length}건 · 예약 ${resvItems.length}건`,
    snapshot: [...byName.entries()].map(([name, qty]) => ({ name, qty })),
  }).catch(() => {});
  revalidatePath("/admin/stock-reconcile");
  revalidatePath("/admin/inventory");
  return { ok: true, count: orders.length + resvItems.length };
}
