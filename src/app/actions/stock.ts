"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { orderTimeOpenForUser } from "@/lib/receivable";
import { windowKeyAt } from "@/lib/schedule";
import { isItemReservationLocked } from "@/lib/reservation-stock";
import { logError } from "@/lib/log";
import { restrictModeForStrict } from "@/lib/restrict-mode";

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
  // 품목 제한 모드면 재고현황 담기를 쓰지 않는다(공구는 발주 화면의 오늘 편성 품목으로만).
  // 저장 판정이라 설정을 못 읽으면 막는 쪽(잠시 후 다시).
  try {
    if (await restrictModeForStrict(user)) {
      return {
        ok: false,
        error: "지금은 재고현황 담기를 쓰지 않아요. 발주 화면에서 오늘 품목에 수량을 넣어 주세요.",
      };
    }
  } catch (err) {
    logError("stock.hold.restrict", err, { userId: user.id });
    return { ok: false, error: "잠시 후 다시 시도해 주세요." };
  }
  if (!(await orderTimeOpenForUser(user))) {
    return { ok: false, error: "지금은 담기 시간이 아니에요." };
  }
  const itemId = String(input.itemId ?? "");
  const qty = Math.max(0, Math.floor(Number(input.qty) || 0));
  const windowDate = windowKeyAt();
  if (!itemId) return { ok: false, error: "품목을 찾을 수 없어요." };
  // 예약발주에 잡힌 품목은 재고현황에서 담을 수 없음(오직 예약발주에서만).
  if (await isItemReservationLocked(itemId)) {
    return { ok: false, error: "예약발주 진행 중인 품목이에요. 예약발주에서 담아 주세요." };
  }

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
        select: { qty: true, source: true },
      });
      // PLAN 행 = 제한 모드 공구 발주분(발주 저장이 관리). 담기로 덮어쓰거나 지우지 않는다.
      if (mine && mine.source === "PLAN") {
        return {
          ok: false,
          error: "이 품목은 편성 발주로 이미 들어가 있어 여기서 바꿀 수 없어요. 본사에 문의해 주세요.",
        };
      }
      const othersHeld = (agg._sum.qty ?? 0) - (mine?.qty ?? 0);
      const availableForMe = item.qty - othersHeld; // 내가 담을 수 있는 최대

      if (qty <= 0) {
        await tx.stockHold.deleteMany({
          where: { userId: user.id, itemId, windowDate, source: "CART" },
        });
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

// 빼기 — 정리용이라 제한 모드에서도 허용. 단 재고현황 담기(CART) 행만 지운다.
// PLAN 행(제한 모드 연동 공구 발주분)은 발주 저장(syncPlanHolds)이 관리하므로 절대 지우지 않는다.
export async function releaseHoldAction(itemId: string): Promise<HoldResult> {
  const user = await getCurrentUser();
  if (!user || user.role !== "MERCHANT_HOTDEAL") return { ok: false };
  await prisma.stockHold.deleteMany({
    where: {
      userId: user.id,
      itemId: String(itemId),
      windowDate: windowKeyAt(),
      source: "CART",
    },
  });
  revalidatePath("/inventory");
  revalidatePath("/order");
  return { ok: true };
}
