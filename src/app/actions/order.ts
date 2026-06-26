"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMerchant } from "@/lib/session";
import {
  allowedCategoriesFor,
  vendorRoleForCategory,
  CATEGORIES,
  needsPickupTime,
  type Category,
} from "@/lib/constants";
import { normalizeOrder } from "@/lib/ai";

export type OrderFormState = { error?: string };

export async function createOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const user = await requireMerchant();

  const category = String(formData.get("category") ?? "") as Category;
  if (!allowedCategoriesFor(user.role).includes(category)) {
    return { error: "이 카테고리에는 발주할 수 없어요." };
  }

  let parsed: { name?: string; qty?: string; note?: string }[] = [];
  try {
    parsed = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    parsed = [];
  }

  const MAX_ITEMS = 100;
  const items = parsed
    .map((r) => ({
      name: String(r.name ?? "").trim().slice(0, 200),
      qty: String(r.qty ?? "").trim().slice(0, 100),
      note: String(r.note ?? "").trim().slice(0, 500),
    }))
    .filter((r) => r.name || r.qty || r.note)
    .slice(0, MAX_ITEMS);

  if (items.length === 0) return { error: "발주할 품목을 한 개 이상 입력하세요." };
  if (!items.some((r) => r.name)) return { error: "품목명을 입력하세요." };

  const pickupTime = needsPickupTime(user.role)
    ? String(formData.get("pickupTime") ?? "").trim().slice(0, 100)
    : "";

  // AI 정리 (키 없으면 규칙기반 자동 폴백)
  const result = await normalizeOrder({
    categoryLabel: CATEGORIES[category].label,
    items,
    pickupTime: pickupTime || undefined,
  });

  // ⚠️ 정리본은 입력과 1:1(개수 동일)일 때만 신뢰. 개수가 다르면 인덱스 정렬이
  // 깨져 수량/부연이 엉뚱한 품목에 붙으므로, 원본을 그대로 저장한다(머니-크리티컬).
  const aligned = result.items.length === items.length;
  const clean = aligned ? result.items : items;
  const engine = aligned ? result.engine : "rule";

  const rawText = items
    .map((r, i) => `${i + 1}. ${[r.name, r.qty, r.note].filter(Boolean).join(" ")}`)
    .join("\n");

  let orderId: string;
  try {
    const order = await prisma.order.create({
      data: {
        userId: user.id,
        category,
        vendorRole: vendorRoleForCategory(category),
        pickupTime: pickupTime || null,
        rawText,
        aiSummary: result.summary,
        aiProcessed: true,
        aiEngine: engine,
        items: {
          create: items.map((r, i) => ({
            sortOrder: i,
            rawName: r.name,
            rawQty: r.qty,
            rawNote: r.note,
            name: clean[i]?.name ?? r.name,
            qty: clean[i]?.qty ?? r.qty,
            note: clean[i]?.note ?? r.note,
          })),
        },
      },
    });
    orderId = order.id;
  } catch (err) {
    console.error("[order] create failed:", err);
    return { error: "발주 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  redirect(`/order/${orderId}?new=1`);
}
