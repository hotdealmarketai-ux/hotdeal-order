"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { windowKeyAt } from "@/lib/schedule";

export type HoldResult = { ok: boolean; error?: string; available?: number };

// ⚠ 재고현황 '담기' 종료 — 공구(공산품)는 예약발주 단일 소스로 전환.
// 담기(StockHold) 신규 생성은 서버에서 하드 차단(UI 우회 방지). 모델·기존 데이터는 휴면 유지.
export async function holdStockAction(_input: {
  itemId: string;
  qty: number;
}): Promise<HoldResult> {
  return {
    ok: false,
    error: "재고현황 담기는 종료됐어요. 공구는 예약발주에서 담아 주세요.",
  };
}

// 빼기(회수)는 남겨둠 — 혹시 남아있는 옛 담기(휴면 데이터)를 정리할 수 있게. 신규 담기는 위에서 차단.
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
