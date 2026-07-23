"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { orderOpenNow } from "@/lib/order-open";
import { windowKeyAt } from "@/lib/schedule";
import { logError } from "@/lib/log";

export type HoldResult = { ok: boolean; error?: string; available?: number };

// 담기 = 실시간 보류(HELD). qty 0이면 빼기. 발주창 열려있을 때만.
// 초과 담기 방지: InventoryItem 행을 FOR UPDATE 로 잠가 동시성 직렬화.
export async function holdStockAction(input: {
  itemId: string;
  qty: number;
}): Promise<HoldResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || user.role !== "MERCHANT_HOTDEAL") {
    return { ok: false, error: "권한이 없어요." };
  }
  if (!(await orderOpenNow(user.role))) {
    return { ok: false, error: "지금은 담기 시간이 아니에요." };
  }
  const itemId = String(input.itemId ?? "");
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  const windowDate = windowKeyAt();
  if (!itemId) return { ok: false, error: "품목을 찾을 수 없어요." };

  try {
    const res = await prisma.$transaction(async (tx) => {
      // 이 품목의 담기 요청을 직렬화(동시 담기 경쟁 방지)
      await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { name: true, qty: true, deletedAt: true },
      });
      if (!item || item.deletedAt) return { ok: false, error: "품목을 찾을 수 없어요." };

      const agg = await tx.stockHold.aggregate({
        where: { itemId, windowDate },
        _sum: { qty: true },
      });
      const mine = await tx.stockHold.findUnique({
        where: { userId_itemId_windowDate: { userId: user.id, itemId, windowDate } },
        select: { qty: true },
      });
      const othersHeld = (agg._sum.qty ?? 0) - (mine?.qty ?? 0);
      const availableForMe = item.qty - othersHeld; // 내가 담을 수 있는 최대

      if (qty <= 0) {
        await tx.stockHold.deleteMany({ where: { userId: user.id, itemId, windowDate } });
        return { ok: true, available: Math.max(0, availableForMe) };
      }
      if (qty > availableForMe) {
        return {
          ok: false,
          error: `남은 수량이 부족해요. (담을 수 있는 최대 ${Math.max(0, availableForMe)}개)`,
          available: Math.max(0, availableForMe),
        };
      }
      await tx.stockHold.upsert({
        where: { userId_itemId_windowDate: { userId: user.id, itemId, windowDate } },
        create: { userId: user.id, itemId, name: item.name, qty, windowDate },
        update: { qty, name: item.name },
      });
      return { ok: true, available: Math.max(0, availableForMe - qty) };
    });
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("stock.hold", err, { itemId, userId: user.id });
    return { ok: false, error: "담기에 실패했어요. 다시 시도해 주세요." };
  }
}

export async function releaseHoldAction(itemId: string): Promise<HoldResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "MERCHANT_HOTDEAL") return { ok: false };
  await prisma.stockHold.deleteMany({
    where: { userId: user.id, itemId: String(itemId), windowDate: windowKeyAt() },
  });
  revalidatePath("/inventory");
  revalidatePath("/order");
  return { ok: true };
}
