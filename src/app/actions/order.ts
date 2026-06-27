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
  type Role,
} from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  ORDER_OPEN_LABEL,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { kstToday, kstDateOf, fullKLabel } from "@/lib/date";
import { normalizeOrder, normalizePickupTime } from "@/lib/ai";

export type OrderFormState = { error?: string };

async function buildPickup(
  role: Role,
  formData: FormData,
  dateStr: string,
): Promise<string> {
  if (!needsPickupTime(role)) return "";
  const raw = String(formData.get("pickupTime") ?? "").trim().slice(0, 100);
  if (!raw) return "";
  const cleaned = await normalizePickupTime(raw);
  return cleaned ? `${fullKLabel(dateStr)} ${cleaned}` : "";
}

type RawRow = { name?: string; qty?: string; note?: string };
type Group = { category: Category; items: { name: string; qty: string; note: string }[] };

const MAX_ITEMS = 100;

function cleanItems(rows: RawRow[]) {
  return rows
    .map((r) => ({
      name: String(r.name ?? "").trim().slice(0, 200),
      qty: String(r.qty ?? "").trim().slice(0, 100),
      note: String(r.note ?? "").trim().slice(0, 500),
    }))
    .filter((r) => r.name || r.qty || r.note)
    .slice(0, MAX_ITEMS);
}

export async function createOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const user = await requireMerchant();

  // 발주 운영시간 가드 — 핫딜마켓 가맹점만 (낮 12시~오후 8시)
  if (hasOrderWindow(user.role) && !isOrderOpen()) {
    return {
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  const allowed = allowedCategoriesFor(user.role);

  // payload: [{ category, items: [...] }] — 여러 카테고리를 한 번에
  let payload: { category?: string; items?: RawRow[] }[] = [];
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    payload = [];
  }

  const groups: Group[] = [];
  for (const g of payload) {
    const category = String(g.category ?? "") as Category;
    if (!allowed.includes(category)) continue;
    const items = cleanItems(Array.isArray(g.items) ? g.items : []);
    if (items.length === 0) continue;
    if (!items.some((r) => r.name)) {
      return { error: `${CATEGORIES[category].label} 품목명을 입력하세요.` };
    }
    groups.push({ category, items });
  }

  if (groups.length === 0) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  // 픽업시간: '오늘 날짜 + 정갈한 시간'으로 정리 (예: 2026년 6월 27일 토요일 오전 7시 30분)
  const pickupTime = await buildPickup(user.role, formData, kstToday());

  // 각 카테고리 AI 정리 (병렬, 키 없으면 규칙기반 폴백)
  const normalized = await Promise.all(
    groups.map((g) =>
      normalizeOrder({
        categoryLabel: CATEGORIES[g.category].label,
        items: g.items,
        pickupTime: pickupTime || undefined,
      }),
    ),
  );

  // 카테고리별 Order 생성 데이터 구성
  const creates = groups.map((g, gi) => {
    const result = normalized[gi];
    // 정리본은 개수가 1:1일 때만 신뢰 (인덱스 어긋남 방지)
    const aligned = result.items.length === g.items.length;
    const clean = aligned ? result.items : g.items;
    const engine = aligned ? result.engine : "rule";
    const rawText = g.items
      .map((r, i) => `${i + 1}. ${[r.name, r.qty, r.note].filter(Boolean).join(" ")}`)
      .join("\n");

    return prisma.order.create({
      data: {
        userId: user.id,
        category: g.category,
        vendorRole: vendorRoleForCategory(g.category),
        pickupTime: pickupTime || null,
        rawText,
        aiSummary: result.summary,
        aiProcessed: true,
        aiEngine: engine,
        items: {
          create: g.items.map((r, i) => ({
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
  });

  let firstId = "";
  try {
    const created = await prisma.$transaction(creates);
    firstId = created[0]?.id ?? "";
  } catch (err) {
    console.error("[order] create failed:", err);
    return { error: "발주 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // 핫딜마켓(여러 카테고리)은 날짜 단위 발주서로, 그 외(단일)는 개별 발주서로
  if (hasOrderWindow(user.role) || groups.length > 1) {
    redirect(`/order/day/${kstToday()}?new=1`);
  }
  redirect(`/order/${firstId}?new=1`);
}

// ============================================================
//  발주 수정 — 본인 발주만. 가맹점은 운영시간(12~20시)에만, 소매업자는 항상.
// ============================================================
export async function updateOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const user = await requireMerchant();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "잘못된 요청이에요." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, category: true, createdAt: true },
  });
  if (!order || order.userId !== user.id) {
    return { error: "수정할 수 없는 발주예요." };
  }

  // 운영시간 가드 — 핫딜마켓 가맹점만
  if (hasOrderWindow(user.role) && !isOrderOpen()) {
    return {
      error: `지금은 수정 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL})`,
    };
  }

  const category = order.category as Category;

  let parsed: RawRow[] = [];
  try {
    parsed = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    parsed = [];
  }
  const items = cleanItems(parsed);
  if (items.length === 0) return { error: "발주할 품목을 한 개 이상 입력하세요." };
  if (!items.some((r) => r.name)) return { error: "품목명을 입력하세요." };

  const orderDate = kstDateOf(order.createdAt);
  const pickupTime = await buildPickup(user.role, formData, orderDate);

  const result = await normalizeOrder({
    categoryLabel: CATEGORIES[category].label,
    items,
    pickupTime: pickupTime || undefined,
  });
  const aligned = result.items.length === items.length;
  const clean = aligned ? result.items : items;
  const engine = aligned ? result.engine : "rule";
  const rawText = items
    .map((r, i) => `${i + 1}. ${[r.name, r.qty, r.note].filter(Boolean).join(" ")}`)
    .join("\n");

  try {
    await prisma.$transaction([
      prisma.orderItem.deleteMany({ where: { orderId } }),
      prisma.order.update({
        where: { id: orderId },
        data: {
          pickupTime: pickupTime || null,
          rawText,
          aiSummary: result.summary,
          aiProcessed: true,
          aiEngine: engine,
          // 수정되면 '발주수정' 표시 + 이전 발주확인은 해제(재확인 필요)
          edited: true,
          editedAt: new Date(),
          confirmed: false,
          confirmedAt: null,
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
      }),
    ]);
  } catch (err) {
    console.error("[order] update failed:", err);
    return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  if (hasOrderWindow(user.role)) {
    redirect(`/order/day/${orderDate}?edited=1`);
  }
  redirect(`/order/${orderId}?edited=1`);
}
