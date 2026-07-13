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
import { currentWindowStartUtc } from "@/lib/schedule";
import { displayQty } from "@/lib/qty";
import { orderLockOf } from "@/lib/receivable";
import { normalizeOrder, normalizePickupTime, parseChatOrder } from "@/lib/ai";
import {
  notifyVendorNewOrder,
  notifyAdminNewOrder,
  notifyMerchantOrderPlaced,
  notifyVendorOrderEdited,
  notifyAdminOrderEdited,
} from "@/lib/push";

export type OrderFormState = { error?: string };

export type ChatParseState = {
  ok: boolean;
  groups?: { category: Category; items: { name: string; qty: string; note: string }[] }[];
  pickupTime?: string;
  error?: string;
};

// 채팅(자유 입력)으로 적은 발주를 AI가 정리해 미리보기용 구조로 반환 (저장은 안 함)
export async function parseChatOrderAction(text: string): Promise<ChatParseState> {
  const user = await requireMerchant();

  if (hasOrderWindow(user.role) && !isOrderOpen()) {
    return {
      ok: false,
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  const clean = String(text ?? "").trim().slice(0, 2000);
  if (!clean) return { ok: false, error: "발주 내용을 입력해 주세요." };

  // 채움채(TOFU)는 체크리스트 전용 — 채팅 분류에서 제외(두부류는 야채로 보냄)
  const allowed: Category[] = allowedCategoriesFor(user.role).filter(
    (c) => c !== "TOFU",
  );
  const catInfo = allowed.map((c) => ({
    key: c,
    label: CATEGORIES[c].label,
    desc: CATEGORIES[c].desc,
  }));

  const parsed = await parseChatOrder({ text: clean, categories: catInfo });
  const groups = parsed.groups
    .filter((g) => allowed.includes(g.category as Category))
    .map((g) => ({
      category: g.category as Category,
      // 미리보기 수량도 최종과 동일하게 '숫자만'으로 정리(displayQty) → 보이는 그대로 저장됨
      items: cleanItems(g.items).map((it) => ({ ...it, qty: displayQty(it.qty) })),
    }))
    .filter((g) => g.items.length > 0);

  remapBenijimin(groups); // #5 베니지민 고구마 → 과일(이름 '고구마', 설명 '베니지민')

  if (groups.length === 0) {
    return {
      ok: false,
      error: "발주 내용을 알아보지 못했어요. 품목과 수량을 적어 주세요.",
    };
  }
  return { ok: true, groups, pickupTime: parsed.pickupTime || "" };
}

// 칸(그리드) 발주 미리보기 — '발주 확정' 눌렀을 때 AI가 정리한 결과를 확인 시트에 보여주기 위함.
// 저장은 안 하고 정리 결과만 반환한다(채팅 미리보기와 동일한 역할). 확정 시엔 preNormalized로 그대로 저장.
export async function previewGridOrderAction(
  payloadJson: string,
): Promise<ChatParseState> {
  const user = await requireMerchant();

  if (hasOrderWindow(user.role) && !isOrderOpen()) {
    return {
      ok: false,
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  let payload: { category?: string; items?: RawRow[] }[] = [];
  try {
    payload = JSON.parse(String(payloadJson ?? "[]"));
  } catch {
    payload = [];
  }

  const allowed = allowedCategoriesFor(user.role);
  const groups: Group[] = [];
  for (const g of payload) {
    const category = String(g.category ?? "") as Category;
    if (!allowed.includes(category)) continue;
    const items = cleanItems(Array.isArray(g.items) ? g.items : []);
    if (items.length === 0) continue;
    groups.push({ category, items });
  }

  remapBenijimin(groups); // #5 베니지민 고구마 → 과일

  if (groups.length === 0) {
    return { ok: false, error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  // 채움채(TOFU)는 체크리스트라 정리 안 함(정확한 이름 보존) — 미리보기에서도 제외(원본은 화면 tofuQty 그대로).
  const normalized = await Promise.all(
    groups.map((g) =>
      g.category === "TOFU"
        ? Promise.resolve({ engine: "rule" as const, items: g.items, summary: "" })
        : normalizeOrder({ categoryLabel: CATEGORIES[g.category].label, items: g.items }),
    ),
  );

  const outGroups = groups
    .map((g, gi) => {
      const result = normalized[gi];
      // 정리본은 개수가 1:1일 때만 신뢰(인덱스 어긋남 방지) — 아니면 원본 유지
      const clean = result.items.length === g.items.length ? result.items : g.items;
      return {
        category: g.category,
        items: clean.map((it, i) => ({
          name: it.name || g.items[i]?.name || "",
          qty: displayQty(it.qty ?? g.items[i]?.qty ?? ""),
          note: it.note ?? g.items[i]?.note ?? "",
        })),
      };
    })
    // TOFU는 시트가 tofuQty로 직접 그리므로 미리보기 응답에선 제외(비-TOFU만 rowsByCat 갱신용)
    .filter((g) => g.category !== "TOFU");

  return { ok: true, groups: outGroups };
}

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

// #5 베니지민 고구마: 야채여도 '과일'로 취급(과일 파트/서부일광 출고). 품목명은 '고구마',
// 설명(note)에 '베니지민' 태그. 오직 '베니지민'이 들어간 고구마만 — 다른 고구마는 야채 그대로.
// groups 를 제자리에서 변형(빈 그룹 제거). 이름 정규화 + 카테고리 라우팅을 결정론적으로 처리.
// 베니지민 오타 변형까지 잡는다: 배니지민·베나지민·베지니민·베니지믄·베니진민 등. #5
const BENI_PAT = "베[니나]지[민믄]|배니지민|베지니민|베니진민";
const hasBeni = (s: string) => {
  const t = (s || "").replace(/\s+/g, "");
  return t.includes("베니지민") || new RegExp(BENI_PAT).test(t);
};
const isGoguma = (s: string) => (s || "").replace(/\s+/g, "").includes("고구마");
function remapBenijimin(groups: Group[]): void {
  // '베니지민'이 name에 있거나, 품목이 '고구마'인데 설명(note)에 베니지민(오타 포함)이 있으면 대상
  const isBeni = (it: { name: string; note: string }) =>
    hasBeni(it.name) || (isGoguma(it.name) && hasBeni(it.note));
  const moved: Group["items"] = [];
  for (const g of groups) {
    const keep: Group["items"] = [];
    for (const it of g.items) {
      if (isBeni(it)) {
        // note에 베니지민 오타가 있으면 표준어로 교정, 없으면 태그 추가
        const note = hasBeni(it.note)
          ? it.note.replace(new RegExp(BENI_PAT, "g"), "베니지민")
          : [it.note, "베니지민"].filter(Boolean).join(" · ");
        const item = { name: "고구마", qty: it.qty, note };
        if (g.category === "FRUIT") keep.push(item);
        else moved.push(item); // 야채 등 → 과일로 이동
      } else {
        keep.push(it);
      }
    }
    g.items = keep;
  }
  if (moved.length) {
    const fruit = groups.find((g) => g.category === "FRUIT");
    if (fruit) fruit.items.push(...moved);
    else groups.push({ category: "FRUIT", items: moved });
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].items.length === 0) groups.splice(i, 1);
  }
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

  // 1일 미수 잠금 — 지난 미입금 계산서가 있으면 서버에서도 차단(UI 우회 방지)
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 발주가 잠겨 있어요. 입금 확인 후 가능해요." };
  }

  // 이번 발주 창에 이미 넣은 발주가 있으면(가맹점) 새 발주 생성 차단 — 수정만 허용.
  // page.tsx의 lockedToEdit(현재 창 기존 발주 조회)를 '서버에서도' 강제 — 더블클릭·뒤로가기
  // 재제출·새 탭·채팅+그리드 각각 제출로 같은 창에 Order가 중복 생성되면 채움채/집계가 2배로
  // 나가는 사고(확정 버그 #1)를 막는다. 소매·벤더(창 없음)는 자유 발주라 해당 없음.
  if (hasOrderWindow(user.role)) {
    const since = new Date(currentWindowStartUtc());
    const existing = await prisma.order.findFirst({
      where: { userId: user.id, createdAt: { gte: since }, status: { not: "CANCELLED" } },
      select: { id: true },
    });
    if (existing) {
      return {
        error: "이번 발주 시간에 이미 넣은 발주가 있어요. '발주 수정'에서 고쳐 주세요.",
      };
    }
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

  remapBenijimin(groups); // #5 베니지민 고구마 → 과일

  if (groups.length === 0) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  // 픽업시간: '오늘 날짜 + 정갈한 시간'으로 정리 (예: 2026년 6월 27일 토요일 오전 7시 30분)
  const pickupTime = await buildPickup(user.role, formData, kstToday());

  // 채팅 발주는 미리보기에서 이미 AI가 정리하고 점주가 확인·수정을 마쳤다 → 저장 시 재정규화하면
  // 점주가 승인한 내용과 달라진다(버그 #3). preNormalized면 재정규화 없이 그대로 저장.
  const preNormalized = String(formData.get("preNormalized") ?? "") === "1";

  // 각 카테고리 AI 정리 (병렬, 키 없으면 규칙기반 폴백)
  // 채움채(TOFU)는 고정 카탈로그 체크리스트라 정규화 없이 정확한 이름 그대로 보존(자동제출 매핑용)
  const normalized = await Promise.all(
    groups.map((g) => {
      if (g.category === "TOFU") {
        return Promise.resolve({
          engine: "rule" as const,
          items: g.items,
          summary: `채움채 발주 ${g.items.length}건`,
        });
      }
      if (preNormalized) {
        // 재정규화 생략 — 미리보기(=AI 정리)에서 점주가 확정한 name/note를 그대로 보존.
        const noteTags = [...new Set(g.items.map((it) => it.note).filter(Boolean))];
        return Promise.resolve({
          engine: "claude" as const,
          items: g.items,
          summary: noteTags.join(" · "),
        });
      }
      return normalizeOrder({
        categoryLabel: CATEGORIES[g.category].label,
        items: g.items,
        pickupTime: pickupTime || undefined,
      });
    }),
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
            qty: displayQty(clean[i]?.qty ?? r.qty),
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

  // 새 발주 알림(웹푸시) — 목적지 업자에게. 실패해도 발주에는 영향 없음.
  const vendorRoles = [
    ...new Set(groups.map((g) => vendorRoleForCategory(g.category))),
  ];
  await Promise.all(
    vendorRoles.map((r) => notifyVendorNewOrder(r, user.storeName)),
  );
  // 관리자(새롭)에게도 발주 접수 알림 — 목적지 업자와 별개로 항상. #10
  await notifyAdminNewOrder(user.storeName);
  // 발주 넣은 점주 본인에게 '주문 완료' 알림
  const placedCount = groups.reduce((n, g) => n + g.items.length, 0);
  await notifyMerchantOrderPlaced(user.id, placedCount);

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

  // 1일 미수 잠금 — 미입금 상태면 수정도 차단(서버 강제)
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 잠겨 있어요. 입금 확인 후 가능해요." };
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

  // 채움채(TOFU)는 정규화 없이 정확한 이름 보존(자동제출 매핑용)
  const result =
    category === "TOFU"
      ? {
          engine: "rule" as const,
          items,
          summary: `채움채 발주 ${items.length}건`,
        }
      : await normalizeOrder({
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
              qty: displayQty(clean[i]?.qty ?? r.qty),
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

  // 받는 업체 + 관리자(새롭)에 '발주 수정' 알림
  await notifyVendorOrderEdited(vendorRoleForCategory(category), user.storeName);
  await notifyAdminOrderEdited(user.storeName);

  if (hasOrderWindow(user.role)) {
    redirect(`/order/day/${orderDate}?edited=1`);
  }
  redirect(`/order/${orderId}?edited=1`);
}
