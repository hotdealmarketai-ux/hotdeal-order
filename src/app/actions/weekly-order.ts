"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMerchant } from "@/lib/session";
import { canOrderWeekly } from "@/lib/constants";
import { WEEKLY_OPEN_LABEL, WEEKLY_CLOSE_LABEL } from "@/lib/schedule";
import { weeklyKeyAt, weeklyLockOf, weeklyOpenNow, weeklyProductMap } from "@/lib/weekly";
import { notifyAdminNewWeeklyOrder } from "@/lib/push";

export type WeeklyOrderState = { error?: string };

// 주간발주 접수/수정 — 주(週)당 점포 1건(WeeklyOrder). 토요일 12~20시에만.
export async function createWeeklyOrderAction(
  _prev: WeeklyOrderState,
  formData: FormData,
): Promise<WeeklyOrderState> {
  const user = await requireMerchant();
  if (!canOrderWeekly(user.role)) {
    return { error: "주간발주 대상 점포가 아니에요." };
  }
  if (!(await weeklyOpenNow())) {
    return {
      error: `지금은 주간발주 시간이 아니에요. (${WEEKLY_OPEN_LABEL} ~ ${WEEKLY_CLOSE_LABEL})`,
    };
  }

  // 지난 주간 입금요청서가 미입금이면 이번 주간발주 잠금(관리자 수동해제 시 예외)
  const lock = await weeklyLockOf(
    user.id,
    user.weeklyOrderUnlock,
    user.weeklyOrderUnlockAt,
  );
  if (lock.locked) {
    return {
      error: "지난 주간발주 입금이 확인되지 않아 잠겨 있어요. 입금 확인 후 가능해요.",
    };
  }

  let payload: { code?: string; qty?: string | number }[] = [];
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    payload = [];
  }

  const productMap = await weeklyProductMap(); // DB 카탈로그(단가 포함)
  const rows: {
    sortOrder: number;
    code: string;
    category: string;
    name: string;
    boxUnit: string;
    qty: number;
    unitPrice: number;
  }[] = [];
  let sort = 0;
  for (const p of Array.isArray(payload) ? payload : []) {
    const item = productMap[String(p.code ?? "")];
    if (!item) continue; // 카탈로그에 없는 코드는 무시(위조 방지)
    const qty = Math.floor(Number(String(p.qty ?? "").replace(/[^0-9.]/g, "")));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    rows.push({
      sortOrder: sort++,
      code: item.code,
      category: item.category,
      name: item.name,
      boxUnit: `1박스 ${item.perBox}개`,
      qty: Math.min(qty, 9999),
      unitPrice: item.supplyPrice, // 발주 시점 단가 스냅샷
    });
  }
  if (rows.length === 0) {
    return { error: "발주할 품목의 수량을 한 개 이상 입력하세요." };
  }

  const weekKey = weeklyKeyAt();
  try {
    const existing = await prisma.weeklyOrder.findUnique({
      where: { userId_weekKey: { userId: user.id, weekKey } },
      select: { id: true },
    });
    if (existing) {
      // 이미 이번 주 발주가 있으면 통째로 교체(수정)
      await prisma.$transaction([
        prisma.weeklyOrderItem.deleteMany({ where: { weeklyOrderId: existing.id } }),
        prisma.weeklyOrder.update({
          where: { id: existing.id },
          // 수정하면 발주확인 리셋 → 관리자에 '수정 요청'으로 표시
          data: {
            edited: true,
            editedAt: new Date(),
            confirmed: false,
            confirmedAt: null,
            items: { create: rows },
          },
        }),
      ]);
    } else {
      await prisma.weeklyOrder.create({
        data: { userId: user.id, weekKey, items: { create: rows } },
      });
    }
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") {
      return { error: "이미 이번 주 주간발주가 접수됐어요. 새로고침 후 수정해 주세요." };
    }
    console.error("[weekly] create failed:", err);
    return { error: "주간발주 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  await notifyAdminNewWeeklyOrder(user.storeName).catch(() => {});
  redirect("/weekly?ok=1");
}
