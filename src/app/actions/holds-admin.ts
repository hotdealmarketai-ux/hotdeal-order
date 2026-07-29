"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { windowKeyAt } from "@/lib/schedule";
import { writeAudit } from "@/lib/audit";
import { logError } from "@/lib/log";

export type AdminHoldResult = { ok: boolean; error?: string; qty?: number };

// 이 품목의 '이 홀드를 뺀 나머지 담기(일일+예약)' 합 — base에서 빼면 이 홀드가 올릴 수 있는 최대.
// 초과판매 방지: 두 소스(StockHold·연동 예약)가 같은 기준재고를 소비하므로 함께 센다.
async function othersHeldForItem(
  tx: Prisma.TransactionClient,
  itemId: string,
  exclude: { dailyUserId?: string; resvItemId?: string },
): Promise<number> {
  const windowDate = windowKeyAt();
  const [dayAgg, resvAgg] = await Promise.all([
    tx.stockHold.aggregate({ where: { itemId, windowDate }, _sum: { qty: true } }),
    tx.reservationOrderItem.aggregate({
      where: {
        inventoryItemId: itemId,
        qty: { gt: 0 },
        stockDeductedAt: null,
        order: { batch: { active: true } },
      },
      _sum: { qty: true },
    }),
  ]);
  let daily = dayAgg._sum.qty ?? 0;
  let resv = resvAgg._sum.qty ?? 0;
  if (exclude.dailyUserId) {
    const mine = await tx.stockHold.findUnique({
      where: {
        userId_itemId_windowDate: {
          userId: exclude.dailyUserId,
          itemId,
          windowDate,
        },
      },
      select: { qty: true },
    });
    daily -= mine?.qty ?? 0;
  }
  if (exclude.resvItemId) {
    const row = await tx.reservationOrderItem.findUnique({
      where: { id: exclude.resvItemId },
      select: { qty: true },
    });
    resv -= row?.qty ?? 0;
  }
  return daily + resv;
}

// 재고현황 '담기'(StockHold) — 특정 점주 수량을 관리자가 조정. 0이면 삭제(전량 회수).
export async function adminSetDailyHoldAction(input: {
  userId: string;
  itemId: string;
  qty: number;
}): Promise<AdminHoldResult> {
  const admin = await requireAdmin();
  const userId = String(input.userId ?? "");
  const itemId = String(input.itemId ?? "");
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  const windowDate = windowKeyAt();
  if (!userId || !itemId) return { ok: false, error: "잘못된 요청이에요." };

  let outcome: { qty: number; name: string };
  try {
    const res = await prisma.$transaction(
      async (tx): Promise<{ ok: false; error: string } | { ok: true; qty: number; name: string }> => {
        await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
        const item = await tx.inventoryItem.findUnique({
          where: { id: itemId },
          select: { name: true, qty: true, deletedAt: true },
        });
        if (!item || item.deletedAt) return { ok: false, error: "품목을 찾을 수 없어요." };
        const others = await othersHeldForItem(tx, itemId, { dailyUserId: userId });
        const maxForThis = item.qty - others;

        if (qty <= 0) {
          await tx.stockHold.deleteMany({ where: { userId, itemId, windowDate } });
          return { ok: true, qty: 0, name: item.name };
        }
        if (qty > maxForThis) {
          return { ok: false, error: `남은 재고를 초과해요. (최대 ${Math.max(0, maxForThis)}개)` };
        }
        await tx.stockHold.upsert({
          where: { userId_itemId_windowDate: { userId, itemId, windowDate } },
          create: { userId, itemId, name: item.name, qty, windowDate },
          update: { qty, name: item.name },
        });
        return { ok: true, qty, name: item.name };
      },
    );
    if (!res.ok) return { ok: false, error: res.error };
    outcome = { qty: res.qty, name: res.name };
  } catch (err) {
    logError("holds.adminDaily", err, { userId, itemId });
    return { ok: false, error: "변경에 실패했어요. 다시 시도해 주세요." };
  }

  const store = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeName: true },
  });
  await writeAudit({
    action: "holds.adminSetDaily",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "stockHold",
    targetId: `${userId}:${itemId}`,
    summary: `담기 조정(재고) · ${store?.storeName ?? userId} · ${outcome.name} → ${outcome.qty}개`,
  });
  revalidatePath("/admin/holds");
  revalidatePath("/inventory");
  revalidatePath("/order");
  return { ok: true, qty: outcome.qty };
}

// 예약발주 재고연동 담기(ReservationOrderItem) — 특정 점주 수량을 관리자가 조정. 0이면 그 예약행 삭제.
export async function adminSetReservationHoldAction(input: {
  resvItemId: string;
  qty: number;
}): Promise<AdminHoldResult> {
  const admin = await requireAdmin();
  const resvItemId = String(input.resvItemId ?? "");
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  if (!resvItemId) return { ok: false, error: "잘못된 요청이에요." };

  const row = await prisma.reservationOrderItem.findUnique({
    where: { id: resvItemId },
    select: {
      inventoryItemId: true,
      name: true,
      order: { select: { user: { select: { storeName: true } } } },
    },
  });
  if (!row || !row.inventoryItemId) {
    return { ok: false, error: "예약 담기를 찾을 수 없어요." };
  }
  const itemId = row.inventoryItemId;

  let outQty: number;
  try {
    const res = await prisma.$transaction(
      async (tx): Promise<{ ok: false; error: string } | { ok: true; qty: number }> => {
        await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
        const item = await tx.inventoryItem.findUnique({
          where: { id: itemId },
          select: { qty: true, deletedAt: true },
        });
        if (!item || item.deletedAt) return { ok: false, error: "품목을 찾을 수 없어요." };
        const others = await othersHeldForItem(tx, itemId, { resvItemId });
        const maxForThis = item.qty - others;

        if (qty <= 0) {
          await tx.reservationOrderItem.deleteMany({ where: { id: resvItemId } });
          return { ok: true, qty: 0 };
        }
        if (qty > maxForThis) {
          return { ok: false, error: `남은 재고를 초과해요. (최대 ${Math.max(0, maxForThis)}개)` };
        }
        await tx.reservationOrderItem.update({ where: { id: resvItemId }, data: { qty } });
        return { ok: true, qty };
      },
    );
    if (!res.ok) return { ok: false, error: res.error };
    outQty = res.qty;
  } catch (err) {
    logError("holds.adminResv", err, { resvItemId });
    return { ok: false, error: "변경에 실패했어요. 다시 시도해 주세요." };
  }

  await writeAudit({
    action: "holds.adminSetResv",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "reservationOrderItem",
    targetId: resvItemId,
    summary: `담기 조정(예약연동) · ${row.order.user.storeName} · ${row.name} → ${outQty}개`,
  });
  revalidatePath("/admin/holds");
  revalidatePath("/inventory");
  revalidatePath("/order");
  revalidatePath("/reservations");
  return { ok: true, qty: outQty };
}
