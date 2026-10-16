"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMerchant, requireAdmin } from "@/lib/session";
import { needsOnboarding } from "@/lib/onboarding";
import { writeAudit } from "@/lib/audit";
import {
  allowedCategoriesFor,
  vendorRoleForCategory,
  CATEGORIES,
  needsPickupTime,
  needsFulfillment,
  type Category,
  type Fulfillment,
  type Role,
} from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  ORDER_OPEN_LABEL,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import {
  kstToday,
  kstDateOf,
  kstDayRange,
  fullKLabel,
  shipmentDayOf,
  normalizeDateStr,
} from "@/lib/date";
import { currentWindowFloorUtc, windowKeyAt, normalizeWindowKey } from "@/lib/schedule";
import { displayQty, qtyNum } from "@/lib/qty";
import { Prisma } from "@prisma/client";
import {
  getDayPlan,
  visibleTofuCatalog,
  lockStore,
  lockAndCheckPlanLines,
  syncPlanHolds,
  releaseOrphanCartHolds,
  windowOrdersWhere,
  isPlanCat,
  parsePlanQty,
  PLAN_CATS,
  type PlanCat,
  type PlanIssue,
  type PlanLineInput,
  type ResolvedPlanLine,
} from "@/lib/order-plan";
import {
  restrictModeFor,
  restrictModeForStrict,
  modeStamp,
  readRestrictConfig,
  restrictAppliesToWindow,
} from "@/lib/restrict-mode";
import {
  orderChannelConfig,
  effectiveChannels,
  fixedNameSets,
  isFixedCategory,
  normFixedName,
  type OrderChannelConfig,
} from "@/lib/order-flags";
import { logError } from "@/lib/log";
import { orderLockOf, orderTimeOpenForUser } from "@/lib/receivable";
import { normalizeOrder, normalizePickupTime, parseChatOrder } from "@/lib/ai";
import { DS_VEG, DS_FRUIT } from "@/lib/ds-catalog";
import {
  notifyVendorNewOrder,
  notifyAdminNewOrder,
  notifyMerchantOrderPlaced,
  notifyVendorOrderEdited,
  notifyAdminOrderEdited,
  notifyMerchantOrderEdited,
} from "@/lib/push";

// lineErrors: 품목 제한 모드 편성 줄별 오류(planItemId → 문구·그 줄에 둘 수 있는 최대). 점주 화면이 줄에 표시.
export type OrderFormState = {
  error?: string;
  lineErrors?: Record<string, { message: string; maxAllowed?: number | null }>;
};

// ── 품목 제한 모드 공용(저장 경로) ───────────────────────────────
const RETRY_LATER = "잠시 후 다시 시도해 주세요.";
const STAMP_CHANGED = "화면이 바뀌었어요. 새로고침 후 다시 해 주세요.";

type Tx = Prisma.TransactionClient;

/** 저장 판정 — 설정을 못 읽으면 null(호출부가 '잠시 후 다시'로 거절). */
async function strictRestricted(user: { id: string; role: string }): Promise<boolean | null> {
  try {
    return await restrictModeForStrict(user);
  } catch (e) {
    logError("order.restrictRead", e, { userId: user.id });
    return null;
  }
}

/**
 * 폼 표식(restrictStamp) 확인. 제한 모드면 반드시 같아야 하고(없는 옛 화면도 거절),
 * 꺼짐이면 제한 모드 화면(R:)에서 그린 폼만 거절 — 꺼짐 화면끼리(자정 넘김 등)는 지금처럼 통과.
 */
function stampError(formStamp: string, restricted: boolean, windowKey: string): string | null {
  if (restricted) return formStamp === modeStamp(true, windowKey) ? null : STAMP_CHANGED;
  return formStamp.startsWith("R:") ? STAMP_CHANGED : null;
}

/** planLines = [{"p":"<planItemId>","q":<정수>}] — q 는 1 이상 정수만. 필드가 없으면 null. */
function parsePlanLines(
  raw: FormDataEntryValue | null,
): { ok: true; lines: PlanLineInput[]; present: boolean } | { ok: false; error: string } {
  if (raw === null) return { ok: true, lines: [], present: false };
  let arr: unknown;
  try {
    arr = JSON.parse(String(raw || "[]"));
  } catch {
    return { ok: false, error: STAMP_CHANGED };
  }
  if (!Array.isArray(arr) || arr.length > 300) return { ok: false, error: STAMP_CHANGED };
  const lines: PlanLineInput[] = [];
  for (const el of arr) {
    const p = typeof el?.p === "string" ? el.p.trim() : "";
    const qRaw = el?.q;
    const q =
      typeof qRaw === "number" ? qRaw : typeof qRaw === "string" && /^\d+$/.test(qRaw.trim()) ? Number(qRaw) : NaN;
    if (!p || p.length > 64) return { ok: false, error: STAMP_CHANGED };
    if (!Number.isInteger(q) || q < 1 || q > 100000) {
      return { ok: false, error: "수량은 1 이상 숫자로만 넣어 주세요." };
    }
    lines.push({ planItemId: p, qty: q });
  }
  return { ok: true, lines, present: true };
}

/** 편성 검사 실패 → 화면 상태(줄별 오류 + 맨 위 한 줄 안내). */
function planIssuesState(issues: PlanIssue[]): OrderFormState {
  const lineErrors: NonNullable<OrderFormState["lineErrors"]> = {};
  for (const i of issues) {
    if (!lineErrors[i.planItemId]) lineErrors[i.planItemId] = { message: i.message, maxAllowed: i.maxAllowed ?? null };
  }
  const first = issues[0];
  const error =
    issues.length === 1
      ? first.name
        ? `‘${first.name}’ ${first.message}`
        : first.message
      : `넣을 수 없는 품목이 ${issues.length}개 있어요. 빨갛게 표시된 줄을 고쳐 주세요.`;
  return { error, lineErrors };
}

type ItemRowData = {
  sortOrder: number;
  rawName: string;
  rawQty: string;
  rawNote: string;
  name: string;
  qty: string;
  note: string;
  planItemId?: string;
  inventoryItemId?: string;
};

/** 편성 줄 OrderItem 저장 모양(약속 문서): 이름=편성(연동은 그 순간 재고) 이름, 정수 수량, 비고 없음. */
function planItemRows(lines: ResolvedPlanLine[], startAt = 0): ItemRowData[] {
  return lines.map((l, i) => ({
    sortOrder: startAt + i,
    rawName: l.name,
    rawQty: String(l.qty),
    rawNote: "",
    name: l.name,
    qty: String(l.qty),
    note: "",
    planItemId: l.planItemId,
    inventoryItemId: l.category === "TOOL" ? l.inventoryItemId : "",
  }));
}

function rowsRawText(rows: { name: string; qty: string; note: string }[]): string {
  return rows.map((r, i) => `${i + 1}. ${[r.name, r.qty, r.note].filter(Boolean).join(" ")}`).join("\n");
}

/** 이 지점이 발주창 K 에 이미 넣은 종류(트랜잭션 안·밖 공용). */
async function orderedCatsIn(db: Tx | typeof prisma, userId: string, windowKey: string): Promise<Set<string>> {
  const rows = await db.order.findMany({ where: windowOrdersWhere(userId, windowKey), select: { category: true } });
  return new Set(rows.map((o) => o.category));
}

/** 재고현황에서 담은 공구(CART)만 — 제한 모드 발주분(PLAN) 원장은 발주 줄 자체가 소스라 제외. */
async function cartHolds(userId: string, windowKey: string) {
  return prisma.stockHold.findMany({
    where: { userId, windowDate: windowKey, source: { not: "PLAN" }, qty: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    select: { itemId: true, name: true, qty: true },
  });
}

/** 발주 저장 트랜잭션 — 대화형, 10초. 교착·쓰기 충돌이면 한 번만 다시. */
async function runOrderTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout: 10_000, maxWait: 5_000 });
    } catch (e) {
      const retryable =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2034" || (e.code === "P2010" && /40P01|40001|deadlock/i.test(e.message)));
      if (attempt < 1 && retryable) continue;
      throw e;
    }
  }
}

export type ChatParseState = {
  ok: boolean;
  groups?: { category: Category; items: { name: string; qty: string; note: string }[] }[];
  pickupTime?: string;
  error?: string;
};

// 채팅(자유 입력)으로 적은 발주를 AI가 정리해 미리보기용 구조로 반환 (저장은 안 함)
export async function parseChatOrderAction(text: string): Promise<ChatParseState> {
  const user = await requireMerchant();

  if (!(await orderTimeOpenForUser(user))) {
    return {
      ok: false,
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  // 발주 방식 설정 — 채팅 발주 잠금(관리자 설정 또는 품목 고정·품목 제한 모드 시 자동)
  if (effectiveChannels(await orderChannelConfig(), await restrictModeFor(user)).chatDisabled) {
    return {
      ok: false,
      error: "지금은 채팅 발주를 사용할 수 없어요. 칸으로 발주해 주세요.",
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
  remapGoguma(groups); // 고구마는 무조건 야채

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

  if (!(await orderTimeOpenForUser(user))) {
    return {
      ok: false,
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  // 발주 방식 설정 — 칸 발주 잠금(관리자 설정)
  const channelCfg = await orderChannelConfig();
  const restricted = await restrictModeFor(user);
  if (effectiveChannels(channelCfg, restricted).gridDisabled) {
    return { ok: false, error: "지금은 칸 발주를 사용할 수 없어요." };
  }

  let payload: { category?: string; items?: RawRow[] }[] = [];
  try {
    payload = JSON.parse(String(payloadJson ?? "[]"));
  } catch {
    payload = [];
  }

  const allowed = allowedCategoriesFor(user.role);
  const groups: Group[] = [];
  // 공구(TOOL)는 재고 이름 그대로(베니지민 이동·AI 정리 대상 아님) — 정리 단계에서 빼 두었다가 뒤에 붙인다.
  const toolGroups: Group[] = [];
  for (const g of payload) {
    const category = String(g.category ?? "") as Category;
    if (!allowed.includes(category)) continue;
    const items = cleanItems(Array.isArray(g.items) ? g.items : []);
    if (items.length === 0) continue;
    if (category === "TOOL") toolGroups.push({ category, items });
    else groups.push({ category, items });
  }

  // 품목 제한 모드 — 과일·야채·공구는 편성 품목 그대로(이동·합치기·AI 없음). 미리보기도 원본 그대로 돌려준다.
  if (restricted) {
    const outGroups = [...groups, ...toolGroups]
      .filter((g) => g.category !== "TOFU")
      .map((g) => ({
        category: g.category,
        items: g.items.map((it) => ({ name: it.name, qty: displayQty(it.qty), note: it.note })),
      }));
    if (outGroups.length === 0 && groups.length === 0) {
      return { ok: false, error: "발주할 품목을 한 개 이상 입력하세요." };
    }
    return { ok: true, groups: outGroups };
  }

  remapBenijimin(groups, channelCfg.fixedFruit); // #5 베니지민 고구마 → 과일(과일 고정 시 이동 보류)
  groups.push(...toolGroups);

  if (groups.length === 0) {
    return { ok: false, error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  // 채움채(TOFU)·공구(TOOL)는 정리 안 함(정확한 이름 보존). TOOL은 재고 담기(고정명)라 AI 개명 시
  // 재고 매칭/취소 복구가 어긋남 → 원본 그대로 통과.
  const normalized = await Promise.all(
    groups.map((g) =>
      g.category === "TOFU" ||
      g.category === "TOOL" ||
      isFixedCategory(g.category, channelCfg)
        ? Promise.resolve({ engine: "rule" as const, items: g.items, summary: "" })
        : normalizeOrder({ categoryLabel: CATEGORIES[g.category].label, items: g.items }),
    ),
  );

  const allOut = groups
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
  // 공구는 아래 이동·합치기 대상에서 뺀다(재고 이름 원형 보존 — '베니지민' 든 공구명이 과일로 옮겨지던 문제).
  const outGroups = allOut.filter((g) => g.category !== "TOOL");
  const toolOut = allOut.filter((g) => g.category === "TOOL");

  // 품목 고정 카테고리로의 유입을 막기 위한 고정 집합(고정 카탈로그로 remap돼 유실되는 문제 차단).
  const fixedSet = new Set<"FRUIT" | "VEG">();
  if (channelCfg.fixedFruit) fixedSet.add("FRUIT");
  if (channelCfg.fixedVeg) fixedSet.add("VEG");
  // R6: 매장 취급 목록 기준으로 과일↔야채 교차 재분류(AI가 이름을 매장 이름으로 맞춘 뒤).
  reclassifyByCatalog(outGroups, allowed as Category[], fixedSet);
  // Q1: 정규화(AI) 이후 최종적으로 한 번 더 remap — AI가 '베니지민 고구마'로 합쳤어도 여기서
  // name="고구마"/note="베니지민"으로 다시 분리한다. 일반 고구마는 야채로, 베니지민만은 과일로 확정(미리보기가 최종과 일치).
  remapBenijimin(outGroups, channelCfg.fixedFruit);
  remapGoguma(outGroups, channelCfg.fixedVeg); // 고구마는 무조건 야채(단 야채 고정 시 이동 보류)
  mergeSameItems(outGroups); // R1 같은 품목+설명 합산

  return { ok: true, groups: [...outGroups, ...toolOut] };
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

// 수령 방식(직접 픽업/배송) — 핫딜마켓 가맹점만. { value|null, error }.
// 기본값 없음 → 미선택 시 저장 차단(UI 우회 방지). 그 외 role은 항상 null.
function readFulfillment(
  role: Role,
  formData: FormData,
): { value: Fulfillment | null; error?: string } {
  if (!needsFulfillment(role)) return { value: null };
  const raw = String(formData.get("fulfillment") ?? "").trim();
  if (raw === "PICKUP" || raw === "DELIVERY") return { value: raw };
  return { value: null, error: "직접 픽업 또는 배송을 선택해 주세요." };
}

// planItemId·inventoryItemId: 관리자 수정 폼이 줄마다 들고 다니는 편성·재고 번호(그 외 경로는 무시).
type RawRow = { name?: string; qty?: string; note?: string; planItemId?: string; inventoryItemId?: string };
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

// cleanItems 와 같은 규칙 + 줄의 편성·재고 번호 유지(관리자 수정 전용).
function cleanItemsWithRefs(rows: RawRow[]) {
  const ref = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 64) : "");
  return rows
    .map((r) => ({
      name: String(r.name ?? "").trim().slice(0, 200),
      qty: String(r.qty ?? "").trim().slice(0, 100),
      note: String(r.note ?? "").trim().slice(0, 500),
      planItemId: ref(r.planItemId),
      inventoryItemId: ref(r.inventoryItemId),
    }))
    .filter((r) => r.name || r.qty || r.note)
    .slice(0, MAX_ITEMS);
}

// 품목명은 썼는데 수량이 비었거나 0 이하인 항목을 찾는다(있으면 그 품목명 반환).
// 수량 없는 품목이 그대로 업자 발주서로 나가 확인 전화·누락으로 이어지던 것을 막는다.
// '3박스'·'조금' 같은 글자 수량은 그대로 허용 — 숫자가 있고 그 값이 0 이하일 때만 오류로 본다.
function findBadQtyItem(items: { name: string; qty: string }[]): string | null {
  for (const it of items) {
    if (!it.name) continue;
    const q = it.qty.trim();
    if (!q) return it.name;
    const m = q.match(/-?\d+(?:\.\d+)?/);
    if (m && parseFloat(m[0]) <= 0) return it.name;
  }
  return null;
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
function remapBenijimin(groups: Group[], fruitFixed = false): void {
  // 과일 품목 고정 ON이면 과일은 관리자 지정 카탈로그다 — 이름을 바꾸거나 과일칸으로 옮기지 않는다
  // (개명/이동이 화이트리스트에 걸려 무경고 유실되던 문제 차단. 지정명 원형 보존).
  if (fruitFixed) return;
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

// 고구마는 무조건 '야채'로 라우팅(야채 파트/조은팜 출고) — 밤·자색·호박고구마 등 '고구마' 들어간 변형 포함.
// 과일로 분류/이동된 고구마를 야채로 되돌린다. 공구·두부칸(임의 상품명)·이미 야채칸은 건드리지 않음.
// ⚠ 단, '베니지민 고구마'는 과일 특례(remapBenijimin이 과일칸에 둔 것)라 제외한다 — 베니지민만은 과일/서부일광 유지.
// reclassifyByCatalog·remapBenijimin 이후 마지막에 돌려 '무조건 야채'를 최종 확정한다(#고구마).
function remapGoguma(groups: Group[], vegFixed = false): void {
  // 야채 품목 고정 ON이면 야채칸이 관리자 지정 카탈로그라 임의 고구마를 옮겨 담을 수 없다 →
  // 과일칸에 적힌 고구마는 그 자리에 그대로 둔다(무경고 유실 방지). 관리자가 고구마를 야채로 받으려면
  // 고정 야채 목록에 '고구마'를 등록하면 된다.
  if (vegFixed) return;
  const moved: Group["items"] = [];
  for (const g of groups) {
    if (g.category !== "FRUIT") continue; // 과일칸의 고구마만 야채로(공구·두부·이미 야채는 그대로)
    const keep: Group["items"] = [];
    for (const it of g.items) {
      // 베니지민 고구마는 과일 특례 → 야채로 되돌리지 않는다.
      if (isGoguma(it.name) && !hasBeni(it.name) && !hasBeni(it.note)) moved.push(it);
      else keep.push(it);
    }
    g.items = keep;
  }
  if (moved.length) {
    const veg = groups.find((g) => g.category === "VEG");
    if (veg) veg.items.push(...moved);
    else groups.push({ category: "VEG", items: moved });
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].items.length === 0) groups.splice(i, 1);
  }
}

// R1: 같은 카테고리 안에서 품목명+설명(note)이 완전히 같은 항목은 하나로 합치고 수량을 더한다.
// (예: 베니지민 고구마를 두 번 넣으면 한 줄로 합쳐 수량 합산. 일반 품목도 동일.)
const qNum = (v: string) => {
  const n = parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10);
  return isNaN(n) ? null : n;
};
function mergeSameItems(groups: Group[]): void {
  for (const g of groups) {
    const map = new Map<string, Group["items"][number]>();
    const order: string[] = [];
    for (const it of g.items) {
      const key = `${it.name.trim()} ${it.note.trim()}`;
      const existing = map.get(key);
      if (existing) {
        const a = qNum(existing.qty);
        const b = qNum(it.qty);
        if (a !== null && b !== null) existing.qty = String(a + b);
        else if (a === null && b !== null) existing.qty = it.qty; // 빈 수량은 채움
      } else {
        const copy = { ...it };
        map.set(key, copy);
        order.push(key);
      }
    }
    g.items = order.map((k) => map.get(k)!);
  }
}

// R6: 칸 발주 교차 재분류 — 매장 취급 목록(엑셀 학습) 기준으로 과일↔야채를 잘못 넣었으면 옮긴다
// (예: 과일을 야채칸에 → 과일). 공구/두부류는 임의 상품명이라 건드리지 않음. 확인 단계서 수정 가능.
const catNorm = (s: string) => (s || "").replace(/\s+/g, "").replace(/\(.*?\)/g, "");
const VEG_SET = new Set(DS_VEG.map(catNorm));
const FRUIT_SET = new Set(DS_FRUIT.map(catNorm));
function reclassifyByCatalog(
  groups: Group[],
  allowed: Category[],
  fixedCats?: Set<"FRUIT" | "VEG">,
): void {
  if (!allowed.includes("FRUIT") || !allowed.includes("VEG")) return;
  const moved: Record<"FRUIT" | "VEG", Group["items"]> = { FRUIT: [], VEG: [] };
  for (const g of groups) {
    if (g.category !== "FRUIT" && g.category !== "VEG") continue;
    const keep: Group["items"] = [];
    const cur: "FRUIT" | "VEG" = g.category;
    for (const it of g.items) {
      const n = catNorm(it.name);
      const correct: "FRUIT" | "VEG" = FRUIT_SET.has(n)
        ? "FRUIT"
        : VEG_SET.has(n)
          ? "VEG"
          : cur;
      // 목적지 카테고리가 '품목 고정'이면 옮기지 않는다(고정 카탈로그로 유입돼 유실되던 문제 차단).
      if (correct !== cur && !fixedCats?.has(correct)) moved[correct].push(it);
      else keep.push(it);
    }
    g.items = keep;
  }
  for (const cat of ["FRUIT", "VEG"] as const) {
    if (!moved[cat].length) continue;
    const target = groups.find((g) => g.category === cat);
    if (target) target.items.push(...moved[cat]);
    else groups.push({ category: cat, items: moved[cat] });
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].items.length === 0) groups.splice(i, 1);
  }
}

// 품목 고정 카테고리 화이트리스트 — 관리자 지정 품목만 허용(서버 권위). remap 이후 호출.
// 지정 목록에 없는 '채워진(품목명 있는)' 항목이 있으면 조용히 버리지 말고 그 이름을 반환(호출부가 오류로 알림).
// extraAllow: 수정 경로에서 '이미 발주된 품목명'을 추가 허용(관리자가 발주창 중 미노출/개명해도 기존 발주 보존).
function enforceFixedWhitelist(
  groups: Group[],
  cfg: OrderChannelConfig,
  nameSets: Record<"FRUIT" | "VEG", Set<string>>,
  extraAllow?: Record<"FRUIT" | "VEG", Set<string>>,
): string | null {
  for (const g of groups) {
    if (!isFixedCategory(g.category, cfg)) continue;
    if (g.category !== "FRUIT" && g.category !== "VEG") continue;
    const base = nameSets[g.category];
    const extra = extraAllow?.[g.category];
    const keep: Group["items"] = [];
    for (const it of g.items) {
      const key = normFixedName(it.name);
      if (base.has(key) || extra?.has(key)) keep.push(it);
      else if (it.name.trim()) return it.name; // 채워진 비지정 품목 → 오류
      // 이름 없는 빈 항목은 조용히 버림(원래 미제출 대상)
    }
    g.items = keep;
  }
  for (let i = groups.length - 1; i >= 0; i--) {
    if (groups[i].items.length === 0) groups.splice(i, 1);
  }
  return null;
}

export async function createOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const user = await requireMerchant();
  if (needsOnboarding(user)) return { error: "오픈 준비를 먼저 완료해 주세요." };

  // 발주 운영시간 가드 — 핫딜마켓 가맹점만 (낮 12시~오후 8시, 또는 관리자 임시 오픈)
  if (!(await orderTimeOpenForUser(user))) {
    return {
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  // 1일 미수 잠금 — 지난 미입금 계산서가 있으면 서버에서도 차단(UI 우회 방지)
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 발주가 잠겨 있어요. 입금 확인 후 가능해요." };
  }

  // 이번 발주창 키 — 모든 새 발주에 저장(편성 날짜·주말 토·일 한 창 묶음·중복 종류 판정 기준).
  const wk = windowKeyAt();

  // 품목 제한 모드 — 저장 판정(설정을 못 읽으면 거절: 한 번의 DB 오류로 자유 품목이 저장되는 일 방지).
  const restricted = await strictRestricted(user);
  if (restricted === null) return { error: RETRY_LATER };
  const stampErr = stampError(String(formData.get("restrictStamp") ?? ""), restricted, wk);
  if (stampErr) return { error: stampErr };

  // 발주 방식 설정 — 발주 방식(칸/채팅) 잠금 서버 최종 검증(UI 우회 방지, fail-closed).
  // 잠긴 채널이 있으면 '허용된 채널의 source'가 명시된 요청만 통과(빈/미지 source 차단).
  // effectiveChannels가 칸·채팅 동시 잠금을 막으므로 정상 제출은 영향 없음. 제한 모드면 채팅 잠금.
  const channelCfg = await orderChannelConfig();
  const { gridDisabled, chatDisabled } = effectiveChannels(channelCfg, restricted);
  const source = String(formData.get("source") ?? "");
  if (gridDisabled && source !== "chat") {
    return { error: "지금은 칸 발주를 사용할 수 없어요." };
  }
  if (chatDisabled && source !== "grid") {
    return { error: "지금은 채팅 발주를 사용할 수 없어요. 칸으로 발주해 주세요." };
  }

  // 이번 발주 창에 '이미 넣은 카테고리'만 중복 생성 차단(수정에서 고치게) — 아직 안 넣은
  // 카테고리(예: 채움채)는 나중에 추가 발주 허용(#6). 카테고리당 1건 유지 = 더블클릭·재제출로
  // 같은 카테고리가 2배 나가는 사고(확정 버그 #1) 방지 + 빠뜨린 종류만 덧붙이기 가능.
  // 소매·벤더(창 없음)는 자유 발주라 해당 없음.
  // 여기서는 빠른 사전 확인(AI 정리 전에 거르기)만 하고, 최종 판정은 저장 트랜잭션 안(지점 잠금 뒤)에서 다시 한다
  // (두 번 누르기·두 기기 동시 제출 경쟁 방지). 발주창 = windowOrdersWhere(지점, 이번 창 키).
  const windowed = hasOrderWindow(user.role);
  const orderedCats = windowed ? await orderedCatsIn(prisma, user.id, wk) : new Set<string>();

  const allowed = allowedCategoriesFor(user.role);

  // payload: [{ category, items: [...] }] — 여러 카테고리를 한 번에
  let payload: { category?: string; items?: RawRow[] }[] = [];
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    payload = [];
  }
  if (!Array.isArray(payload)) payload = [];

  if (restricted) {
    return createRestrictedOrder({ user, formData, payload, allowed, wk, orderedCats });
  }

  // ── 꺼짐(기존 동작) ──────────────────────────────────────
  const groups: Group[] = [];
  // 공구(TOOL)는 화면이 보낸 값을 믿지 않고 서버 담기원장으로 다시 만든다(아래). 여기선 '공구도 보냈는지'만 본다.
  let wantTool = false;
  for (const g of payload) {
    const category = String(g.category ?? "") as Category;
    if (!allowed.includes(category)) continue;
    const items = cleanItems(Array.isArray(g.items) ? g.items : []);
    if (items.length === 0) continue;
    if (category === "TOOL") {
      wantTool = true;
      continue;
    }
    if (!items.some((r) => r.name)) {
      return { error: `${CATEGORIES[category].label} 품목명을 입력하세요.` };
    }
    const badQty = findBadQtyItem(items);
    if (badQty) {
      return { error: `‘${badQty}’ 수량을 입력해 주세요.` };
    }
    groups.push({ category, items });
  }

  remapBenijimin(groups, channelCfg.fixedFruit); // #5 베니지민 고구마 → 과일(과일 고정 시 이동 보류)
  remapGoguma(groups, channelCfg.fixedVeg); // 고구마는 무조건 야채(야채 고정 시 이동 보류)
  mergeSameItems(groups); // R1 같은 품목+설명 합산

  // 품목 고정 카테고리 — 관리자 지정 품목만 허용(remap 이후 검증). 지정 외 품목이 채워져 있으면 저장 차단.
  if (channelCfg.fixedFruit || channelCfg.fixedVeg) {
    const dropped = enforceFixedWhitelist(groups, channelCfg, await fixedNameSets());
    if (dropped) {
      return { error: `‘${dropped}’은(는) 지정 품목이 아니에요. 지정 품목에서 선택해 주세요.` };
    }
  }

  // 공구(TOOL) = 서버 담기원장(재고현황에서 담은 것)으로 재구성 — 화면 값 그대로 저장하던 구멍을 막는다.
  // 줄마다 재고 id 를 같이 저장(계산서 불러오기가 이름보다 먼저 찾음).
  const toolInv: string[] = [];
  if (wantTool) {
    const holds = await cartHolds(user.id, wk);
    if (holds.length === 0) {
      return { error: "담은 공구가 없어요. 새로고침 후 재고에서 다시 담아 주세요." };
    }
    for (const h of holds) toolInv.push(h.itemId);
    groups.push({
      category: "TOOL",
      items: holds.map((h) => ({ name: h.name, qty: String(h.qty), note: "" })),
    });
  }

  if (groups.length === 0) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  // 이미 발주한 카테고리를 또 제출하면 거부(중복 방지). 안 넣었던 카테고리만 새로 추가된다(#6).
  const dupMsg = (c: Category) =>
    `${CATEGORIES[c].label}는 이번 발주 시간에 이미 넣었어요. '발주 수정'에서 고쳐 주세요.`;
  const dupCat = groups.find((g) => orderedCats.has(g.category));
  if (dupCat) return { error: dupMsg(dupCat.category) };

  // 픽업시간: '오늘 날짜 + 정갈한 시간'으로 정리 (예: 2026년 6월 27일 토요일 오전 7시 30분)
  const pickupTime = await buildPickup(user.role, formData, kstToday());

  // 수령 방식(직접 픽업/배송) — 핫딜마켓 가맹점은 반드시 선택(미선택 시 저장 차단)
  const ful = readFulfillment(user.role, formData);
  if (ful.error) return { error: ful.error };

  // 채팅 발주는 미리보기에서 이미 AI가 정리하고 점주가 확인·수정을 마쳤다 → 저장 시 재정규화하면
  // 점주가 승인한 내용과 달라진다(버그 #3). preNormalized면 재정규화 없이 그대로 저장.
  const preNormalized = String(formData.get("preNormalized") ?? "") === "1";

  // 각 카테고리 AI 정리 (병렬, 키 없으면 규칙기반 폴백)
  // 채움채(TOFU)는 고정 카탈로그 체크리스트라 정규화 없이 정확한 이름 그대로 보존(자동제출 매핑용)
  // 공구(TOOL)는 재고 이름 그대로(계산서 이름 차감·취소 복구가 이름 기준)
  const normalized = await Promise.all(
    groups.map((g) => {
      if (g.category === "TOFU") {
        return Promise.resolve({
          engine: "rule" as const,
          items: g.items,
          summary: `채움채 발주 ${g.items.length}건`,
        });
      }
      if (g.category === "TOOL") {
        return Promise.resolve({
          engine: "rule" as const,
          items: g.items,
          summary: `공구 발주 ${g.items.length}건`,
        });
      }
      if (isFixedCategory(g.category, channelCfg)) {
        // 품목 고정 — 관리자 지정 품목명 그대로 보존(AI 개명 금지)
        const noteTags = [...new Set(g.items.map((it) => it.note).filter(Boolean))];
        return Promise.resolve({
          engine: "rule" as const,
          items: g.items,
          summary: noteTags.join(" · "),
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
  const creates: Prisma.OrderUncheckedCreateInput[] = groups.map((g, gi) => {
    const result = normalized[gi];
    // 정리본은 개수가 1:1일 때만 신뢰 (인덱스 어긋남 방지)
    const aligned = result.items.length === g.items.length;
    const clean = aligned ? result.items : g.items;
    const engine = aligned ? result.engine : "rule";
    const isTool = g.category === "TOOL";

    return {
      userId: user.id,
      category: g.category,
      vendorRole: vendorRoleForCategory(g.category),
      pickupTime: pickupTime || null,
      fulfillment: ful.value,
      rawText: rowsRawText(g.items),
      aiSummary: result.summary,
      aiProcessed: true,
      aiEngine: engine,
      windowKey: wk,
      items: {
        create: g.items.map((r, i) => ({
          sortOrder: i,
          rawName: r.name,
          rawQty: r.qty,
          rawNote: r.note,
          name: clean[i]?.name ?? r.name,
          qty: displayQty(clean[i]?.qty ?? r.qty),
          note: clean[i]?.note ?? r.note,
          inventoryItemId: isTool ? (toolInv[i] ?? "") : "",
        })),
      },
    };
  });

  let firstId = "";
  try {
    const out = await runOrderTx(async (tx) => {
      // 지점 잠금 → '이번 창에 이미 넣은 종류'를 잠금 안에서 다시 확인 → 저장
      await lockStore(tx, user.id);
      if (windowed) {
        const cats = await orderedCatsIn(tx, user.id, wk);
        const dup = groups.find((g) => cats.has(g.category));
        if (dup) return { dup: dup.category, firstId: "" };
      }
      let first = "";
      for (const data of creates) {
        const o = await tx.order.create({ data, select: { id: true } });
        if (!first) first = o.id;
      }
      return { dup: null as Category | null, firstId: first };
    });
    if (out.dup) return { error: dupMsg(out.dup) };
    firstId = out.firstId;
  } catch (err) {
    console.error("[order] create failed:", err);
    return { error: "발주 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // 공구(TOOL) 기준재고 차감은 발주 시점이 아니라 '매일 오후 8시 마감 정산'에서 일괄 처리한다
  // (개별 차감 누락 방지 — Order.stockDeductedAt 멱등). 담기(HELD)는 실시간 남은수량 표시용으로
  // 유지되며, 마감에 발주분은 정산·미발주분은 자동 해제된다. → src/lib/stock-hold.ts deductToolOrders

  await afterOrderCreated(
    user,
    groups.map((g) => ({ category: g.category, count: g.items.length })),
  );

  // 핫딜마켓(여러 카테고리)은 날짜 단위 발주서로, 그 외(단일)는 개별 발주서로
  if (windowed || groups.length > 1) {
    redirect(`/order/day/${kstToday()}?new=1`);
  }
  redirect(`/order/${firstId}?new=1`);
}

// 새 발주 알림(웹푸시) — 목적지 업자·관리자·점주 본인. 실패해도 발주에는 영향 없음.
async function afterOrderCreated(
  user: { id: string; storeName: string },
  placed: { category: Category; count: number }[],
): Promise<void> {
  const vendorRoles = [...new Set(placed.map((g) => vendorRoleForCategory(g.category)))];
  await Promise.all(vendorRoles.map((r) => notifyVendorNewOrder(r, user.storeName)));
  // 관리자(새롭)에게도 발주 접수 알림 — 목적지 업자와 별개로 항상. #10
  await notifyAdminNewOrder(user.storeName);
  // 발주 넣은 점주 본인에게 '주문 완료' 알림
  const placedCount = placed.reduce((n, g) => n + g.count, 0);
  await notifyMerchantOrderPlaced(user.id, placedCount);
}

// ============================================================
//  품목 제한 모드 — 새 발주. 과일·야채·공구는 planLines(편성 품목 번호+정수 수량)만으로 만들고
//  payload 의 FRUIT/VEG/TOOL 그룹은 무시한다(이름·종류는 DB 편성에서). 채움채는 payload TOFU 를
//  그날 보이는 목록 이름으로만 받는다. 고구마 이동·합치기·AI 정리·재분류는 하지 않는다.
//  잠금 순서: 지점(lockStore) → 편성 품목 줄(id 순) → 연동 재고(id 순) — lockAndCheckPlanLines 안.
// ============================================================
async function createRestrictedOrder(args: {
  user: Awaited<ReturnType<typeof requireMerchant>>;
  formData: FormData;
  payload: { category?: string; items?: RawRow[] }[];
  allowed: Category[];
  wk: string;
  orderedCats: Set<string>;
}): Promise<OrderFormState> {
  const { user, formData, payload, allowed, wk, orderedCats } = args;

  const pl = parsePlanLines(formData.get("planLines"));
  if (!pl.ok) return { error: pl.error };

  // 채움채 — payload TOFU 그룹(카탈로그 이름 그대로). 그날 보이는 목록에 있는 이름만.
  let tofuItems: Group["items"] = [];
  if (allowed.includes("TOFU")) {
    for (const g of payload) {
      if (String(g.category ?? "") !== "TOFU") continue;
      tofuItems = cleanItems(Array.isArray(g.items) ? g.items : []);
    }
  }
  if (tofuItems.length > 0) {
    if (!tofuItems.some((r) => r.name)) return { error: `${CATEGORIES.TOFU.label} 품목명을 입력하세요.` };
    const badQty = findBadQtyItem(tofuItems);
    if (badQty) return { error: `‘${badQty}’ 수량을 입력해 주세요.` };
    const plan = await getDayPlan(wk);
    const visible = new Set(visibleTofuCatalog(plan.tofu.hiddenSeqs).map((p) => p.name));
    const bad = tofuItems.find((it) => it.name && !visible.has(it.name));
    if (bad) return { error: `‘${bad.name}’는 지금 발주할 수 없어요. 새로고침 후 다시 시도해 주세요.` };
    tofuItems = tofuItems.filter((it) => it.name);
  }

  if (pl.lines.length === 0 && tofuItems.length === 0) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }
  const dupMsg = (c: Category) =>
    `${CATEGORIES[c].label}는 이번 발주 시간에 이미 넣었어요. '발주 수정'에서 고쳐 주세요.`;
  if (tofuItems.length > 0 && orderedCats.has("TOFU")) return { error: dupMsg("TOFU") };

  const pickupTime = await buildPickup(user.role, formData, kstToday());
  const ful = readFulfillment(user.role, formData);
  if (ful.error) return { error: ful.error };

  type Out =
    | { kind: "ok"; placed: { category: Category; count: number }[] }
    | { kind: "dup"; category: Category }
    | { kind: "plan"; issues: PlanIssue[] }
    | { kind: "error"; error: string };

  let out: Out;
  try {
    out = await runOrderTx<Out>(async (tx) => {
      await lockStore(tx, user.id);
      const cats = await orderedCatsIn(tx, user.id, wk);
      if (tofuItems.length > 0 && cats.has("TOFU")) return { kind: "dup", category: "TOFU" };

      // 모드 전에 담아 두고 발주엔 안 쓴 재고현황 담기는 풀어 준다(제한 모드 화면은 담기를 쓰지 않음).
      await releaseOrphanCartHolds(tx, user.id, wk);
      const chk = await lockAndCheckPlanLines(tx, {
        userId: user.id,
        windowKey: wk,
        lines: pl.lines,
        replaceOrderIds: [],
      });
      if (!chk.ok) return { kind: "plan", issues: chk.issues };

      const byCat = new Map<PlanCat, ResolvedPlanLine[]>();
      for (const l of chk.resolved) {
        const list = byCat.get(l.category) ?? [];
        list.push(l);
        byCat.set(l.category, list);
      }
      for (const c of byCat.keys()) {
        if (!allowed.includes(c)) return { kind: "error", error: "발주할 수 없는 종류가 있어요. 새로고침 후 다시 해 주세요." };
        if (cats.has(c)) return { kind: "dup", category: c };
      }

      const placed: { category: Category; count: number }[] = [];
      const common = {
        userId: user.id,
        pickupTime: pickupTime || null,
        fulfillment: ful.value,
        aiProcessed: true,
        aiEngine: "rule",
        windowKey: wk,
      };
      for (const c of PLAN_CATS) {
        const lines = byCat.get(c);
        if (!lines || lines.length === 0) continue;
        const rows = planItemRows(lines);
        await tx.order.create({
          data: {
            ...common,
            category: c,
            vendorRole: vendorRoleForCategory(c),
            rawText: rowsRawText(rows),
            aiSummary: c === "TOOL" ? `공구 발주 ${rows.length}건` : "",
            items: { create: rows },
          },
          select: { id: true },
        });
        placed.push({ category: c, count: rows.length });
      }
      if (tofuItems.length > 0) {
        await tx.order.create({
          data: {
            ...common,
            category: "TOFU",
            vendorRole: vendorRoleForCategory("TOFU"),
            rawText: rowsRawText(tofuItems),
            aiSummary: `채움채 발주 ${tofuItems.length}건`,
            items: {
              create: tofuItems.map((r, i) => ({
                sortOrder: i,
                rawName: r.name,
                rawQty: r.qty,
                rawNote: r.note,
                name: r.name,
                qty: displayQty(r.qty),
                note: r.note,
              })),
            },
          },
          select: { id: true },
        });
        placed.push({ category: "TOFU", count: tofuItems.length });
      }
      // 연동 공구 발주분 → 담기원장(PLAN) 맞춤(같은 트랜잭션)
      if (byCat.has("TOOL")) await syncPlanHolds(tx, user.id, wk);
      return { kind: "ok", placed };
    });
  } catch (err) {
    console.error("[order] restricted create failed:", err);
    return { error: "발주 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  if (out.kind === "dup") return { error: dupMsg(out.category) };
  if (out.kind === "plan") return planIssuesState(out.issues);
  if (out.kind === "error") return { error: out.error };

  await afterOrderCreated(user, out.placed);
  redirect(`/order/day/${kstToday()}?new=1`);
}

// ============================================================
//  발주 수정 — 본인 발주만. 가맹점은 운영시간(12~20시)에만, 소매업자는 항상.
// ============================================================
export async function updateOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const user = await requireMerchant();
  if (needsOnboarding(user)) return { error: "오픈 준비를 먼저 완료해 주세요." };
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "잘못된 요청이에요." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      category: true,
      createdAt: true,
      items: {
        where: { planItemId: { not: "" } },
        orderBy: { sortOrder: "asc" },
        select: { rawName: true, rawQty: true, rawNote: true, name: true, qty: true, note: true, planItemId: true, inventoryItemId: true },
      },
    },
  });
  if (!order || order.userId !== user.id) {
    return { error: "수정할 수 없는 발주예요." };
  }

  // 단건 수정은 자유 품목 저장 경로라, 품목이 정해진 발주(품목 제한 모드·품목 고정)는 여기서 받지 않는다
  // (주소만 알면 아무 품목이나 저장되던 구멍). 하루 수정 화면이 편성·고정 검사를 한다.
  const restricted = await strictRestricted(user);
  if (restricted === null) return { error: RETRY_LATER };
  if (
    (hasOrderWindow(user.role) && restricted) ||
    isFixedCategory(order.category as Category, await orderChannelConfig())
  ) {
    return { error: "품목이 정해진 발주라 여기서는 고칠 수 없어요. ‘발주 수정’(하루 수정 화면)에서 고쳐 주세요." };
  }

  // 운영시간 가드 — 핫딜마켓 가맹점만
  if (hasOrderWindow(user.role) && !isOrderOpen()) {
    return {
      error: `지금은 수정 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL})`,
    };
  }

  // '이번 발주창'에 넣은 발주만 수정 가능 — 창이 열려 있다고 지난 창(이미 업체로 나간) 발주까지
  // 고칠 수 있으면 실제 출고와 어긋난다.
  if (
    hasOrderWindow(user.role) &&
    order.createdAt.getTime() < currentWindowFloorUtc()
  ) {
    return { error: "지난 발주는 수정할 수 없어요. 본사에 문의해 주세요." };
  }

  // 계산서가 발행된 발주는 수정 불가(역할 무관) — 청구액↔발주 내용 불일치 방지.
  // 계산서 Invoice.date = '출고일'(발주일+1) 기준이라, 발주의 출고일로 매칭해야 함.
  // (발주일로 찾으면 '어제 발주분(오늘 출고)' 계산서와 '오늘 넣은 발주(내일 출고)'가 겹쳐 오작동)
  const issuedInv = await prisma.invoice.findFirst({
    where: {
      userId: user.id,
      kind: "DAILY",
      date: shipmentDayOf(kstDateOf(order.createdAt)),
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  if (issuedInv) {
    return { error: "입금요청서가 발행된 발주는 수정할 수 없어요. 본사에 문의해 주세요." };
  }

  // 1일 미수 잠금 — 미입금 상태면 수정도 차단(서버 강제)
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 잠겨 있어요. 입금 확인 후 가능해요." };
  }

  const category = order.category as Category;

  // 공구(TOOL) 수정 = 담기원장(StockHold)이 단일 소스. 점주는 수정 화면에서 실시간으로 담기/빼기 하고,
  // 저장 시 그 담은 상태(myHolds)로 주문 품목을 재구성한다(클라이언트 items 무시 → 담기와 주문이 어긋나지 않음).
  // 수정은 항상 '이번 발주창'으로 게이트되므로 windowKeyAt()=발주 당시 창 → myHolds가 그 공구 담기와 일치.
  // 편성 줄(planItemId 있음 — 모드를 끈 직후 같은 창)은 담기원장에 없으니 지우지 않고 그대로 앞에 둔다.
  let items: { name: string; qty: string; note: string }[];
  let toolRefs: { planItemId: string; inventoryItemId: string }[] = [];
  const keptPlanRows = category === "TOOL" ? order.items : [];
  const planRefByName = new Map(
    order.items.map((r) => [r.name, { planItemId: r.planItemId, inventoryItemId: "" }]),
  );
  if (category === "TOOL") {
    const holds = await cartHolds(user.id, windowKeyAt());
    items = [
      ...keptPlanRows.map((r) => ({ name: r.name, qty: r.qty, note: r.note })),
      ...holds.map((h) => ({ name: h.name, qty: String(h.qty), note: "" })),
    ];
    toolRefs = [
      ...keptPlanRows.map((r) => ({ planItemId: r.planItemId, inventoryItemId: r.inventoryItemId })),
      ...holds.map((h) => ({ planItemId: "", inventoryItemId: h.itemId })),
    ];
    if (holds.length === 0) {
      return { error: "담은 공구가 없어요. 재고에서 담아 주세요." };
    }
  } else {
    let parsed: RawRow[] = [];
    try {
      parsed = JSON.parse(String(formData.get("items") ?? "[]"));
    } catch {
      parsed = [];
    }
    items = cleanItems(parsed);
    if (items.length === 0) return { error: "발주할 품목을 한 개 이상 입력하세요." };
    if (!items.some((r) => r.name)) return { error: "품목명을 입력하세요." };
    const badQtyItem = findBadQtyItem(items);
    if (badQtyItem) return { error: `‘${badQtyItem}’ 수량을 입력해 주세요.` };
  }

  const orderDate = kstDateOf(order.createdAt);
  const pickupTime = await buildPickup(user.role, formData, orderDate);

  // 수령 방식(직접 픽업/배송) — 핫딜마켓 가맹점은 반드시 선택
  const ful = readFulfillment(user.role, formData);
  if (ful.error) return { error: ful.error };

  // 채움채(TOFU)·공구(TOOL)는 정규화 없이 정확한 이름 보존
  // (공구는 재고 매칭·취소 복구가 이름 기준이라 AI 개명 시 어긋남 → 원본 그대로).
  const result =
    category === "TOFU" || category === "TOOL"
      ? {
          engine: "rule" as const,
          items,
          summary:
            category === "TOFU"
              ? `채움채 발주 ${items.length}건`
              : `공구 발주 ${items.length}건`,
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
          fulfillment: ful.value,
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
            create: items.map((r, i) => {
              const name = clean[i]?.name ?? r.name;
              // 공구: 담기 줄은 재고 id, 보존한 편성 줄은 원래 번호 / 그 외: 원래 편성 줄과 이름이 같으면 번호 유지
              const ref =
                category === "TOOL" ? toolRefs[i] : planRefByName.get(name);
              return {
                sortOrder: i,
                rawName: r.name,
                rawQty: r.qty,
                rawNote: r.note,
                name,
                qty: displayQty(clean[i]?.qty ?? r.qty),
                note: clean[i]?.note ?? r.note,
                planItemId: ref?.planItemId ?? "",
                inventoryItemId: ref?.inventoryItemId ?? "",
              };
            }),
          },
        },
      }),
    ]);
  } catch (err) {
    console.error("[order] update failed:", err);
    return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  // 수령 방식은 발주 1건(그날 제출) 전체에 동일 적용 — 같은 날 다른 카테고리 발주도 함께 맞춤.
  if (needsFulfillment(user.role)) {
    try {
      const { start, end } = kstDayRange(orderDate);
      await prisma.order.updateMany({
        where: {
          userId: user.id,
          id: { not: orderId },
          createdAt: { gte: start, lt: end },
          status: { not: "CANCELLED" },
        },
        data: { fulfillment: ful.value },
      });
    } catch (e) {
      logError("order.fulfillmentSync", e, { userId: user.id, orderId });
    }
  }

  // 받는 업체 + 관리자(새롭)에 '발주 수정' 알림
  await notifyVendorOrderEdited(vendorRoleForCategory(category), user.storeName);
  await notifyAdminOrderEdited(user.storeName);

  if (hasOrderWindow(user.role)) {
    redirect(`/order/day/${orderDate}?edited=1`);
  }
  redirect(`/order/${orderId}?edited=1`);
}

// ============================================================
//  관리자(새롭) 발주 수정 — 아무 지점 발주나. 발주창 제한 없음(마감 후·지난 발주도).
//  계산서 발행분·취소분은 차단(정합). 저장 후 점주+받는 업체에 알림.
// ============================================================
export async function adminUpdateOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const admin = await requireAdmin();
  const orderId = String(formData.get("orderId") ?? "");
  if (!orderId) return { error: "잘못된 요청이에요." };

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      userId: true,
      category: true,
      createdAt: true,
      status: true,
      windowKey: true,
      user: { select: { role: true, storeName: true } },
      items: { select: { name: true, qty: true, rawName: true, rawQty: true, planItemId: true, inventoryItemId: true } },
    },
  });
  if (!order) return { error: "발주를 찾을 수 없어요." };
  if (order.status === "CANCELLED") {
    return { error: "취소된 발주는 수정할 수 없어요." };
  }

  // 계산서 발행분은 잠금(청구액↔발주 정합) — 관리자도 동일. 발행 후 변경은 계산서 수정으로.
  // Invoice.date = 출고일 기준 → 발주의 출고일(shipmentDayOf)로 매칭(발주일로 찾으면 하루 어긋나 오작동).
  const issuedInv = await prisma.invoice.findFirst({
    where: {
      userId: order.userId,
      kind: "DAILY",
      date: shipmentDayOf(kstDateOf(order.createdAt)),
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  if (issuedInv) {
    return { error: "입금요청서가 발행된 발주예요. 계산서를 수정해 주세요." };
  }

  const ownerRole = order.user.role as Role;
  const category = order.category as Category;
  // 이 발주가 속한 발주창(저장된 키, 레거시는 생성 시각으로 계산) — 편성 품목 찾기·잠금·담기원장 기준
  const W = order.windowKey ?? windowKeyAt(order.createdAt.getTime());

  let parsed: RawRow[] = [];
  try {
    parsed = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    parsed = [];
  }
  const items = cleanItemsWithRefs(Array.isArray(parsed) ? parsed : []);
  if (items.length === 0) return { error: "발주할 품목을 한 개 이상 입력하세요." };
  if (!items.some((r) => r.name)) return { error: "품목명을 입력하세요." };
  const badQtyItem = findBadQtyItem(items);
  if (badQtyItem) return { error: `‘${badQtyItem}’ 수량을 입력해 주세요.` };

  // 편성 품목 번호 — 폼이 들고 온 번호는 그 창 편성에 실제 있는 것만 인정, 번호 없는 줄은
  // 그 창 편성 품목과 이름이 정확히 같으면 번호를 붙인다(전 지점 합계·남은 수량에서 빠지지 않게).
  // 단 그 창 제한 모드 대상이 아닌 지점(시험 지점 밖·모드 끔)은 새로 붙이지 않는다 — 재고현황 담기 공구가
  // 편성 줄로 바뀌면 점주가 더는 그 담기를 고칠 수 없다. 이미 번호가 있던 줄만 그대로 둔다.
  if (isPlanCat(category)) {
    let ownerRestricted: boolean;
    try {
      ownerRestricted = restrictAppliesToWindow(await readRestrictConfig(), { id: order.userId, role: ownerRole }, W);
    } catch {
      return { error: "잠시 후 다시 시도해 주세요." };
    }
    const plan = await getDayPlan(W);
    const planItems = plan.cats[category].items;
    const byId = new Map(planItems.map((p) => [p.id, p]));
    const byName = new Map(planItems.map((p) => [p.name.trim(), p]));
    const byInv = new Map(planItems.filter((p) => p.inventoryItemId).map((p) => [p.inventoryItemId, p]));
    // 새로 붙이지 않는 옛 줄(점주 하루 수정의 '이전 방식 발주 · 그대로 유지'와 같은 규칙):
    //  · 이 발주에 원래 있던 편성 번호 없는 줄을 그대로 둔 것(이름·수량 같음) — 붙이면 반박스·1박스반 같은 수량이
    //    정수로 바뀌거나 정수 검사에 걸린다. 새로 넣거나 바꾼 줄만 붙인다(정수 아니면 아래 검사로 안내).
    //    폼은 원문(rawName·rawQty)을 보내므로 원문·정리본 둘 다로 맞춰 보고, 원래 줄 수만큼만 인정한다.
    //  · 모드 전 재고현황 담기(CART)로 넣은 공구 — 그 담기가 이 발주의 원장이라 편성 줄로 바꾸면 '늘리기'로 거절된다.
    //    대신 담기·원래 수량 중 큰 값보다 늘리면 원장이 모자라 실재고를 넘기므로 거절(줄이기·그대로는 허용, 소수 포함)
    const carts = ownerRestricted && category === "TOOL"
      ? await prisma.stockHold.findMany({
          where: { userId: order.userId, windowDate: W, source: { not: "PLAN" } },
          select: { itemId: true, name: true, qty: true },
        })
      : [];
    const cartById = new Map(carts.map((c) => [c.itemId, c.qty]));
    const cartByName = new Map(carts.map((c) => [c.name.trim(), c.qty]));
    const legacyKey = (name: string, qty: string) => `${name.trim()}\u0001${String(qty).trim()}`;
    const origCount = new Map<string, number>();
    const origQtyById = new Map<string, number>();
    const origQtyByName = new Map<string, number>();
    for (const i of order.items) {
      if (i.planItemId) continue;
      for (const k of new Set([legacyKey(i.name, i.qty), legacyKey(i.rawName, displayQty(i.rawQty))])) {
        origCount.set(k, (origCount.get(k) ?? 0) + 1);
      }
      if (i.inventoryItemId) origQtyById.set(i.inventoryItemId, (origQtyById.get(i.inventoryItemId) ?? 0) + qtyNum(i.qty));
      origQtyByName.set(i.name.trim(), (origQtyByName.get(i.name.trim()) ?? 0) + qtyNum(i.qty));
    }
    for (const r of items) {
      let p = r.planItemId ? byId.get(r.planItemId) : undefined;
      const dq = displayQty(r.qty);
      const cartQty = (r.inventoryItemId ? cartById.get(r.inventoryItemId) : undefined) ?? cartByName.get(r.name.trim());
      if (!p && ownerRestricted && cartQty !== undefined) {
        const orig = (r.inventoryItemId ? origQtyById.get(r.inventoryItemId) : undefined) ?? origQtyByName.get(r.name.trim()) ?? 0;
        const limit = Math.max(cartQty, orig);
        if (qtyNum(dq) > limit) {
          return { error: `‘${r.name}’은(는) 모드 전에 재고현황으로 담은 품목이라 ${limit}개보다 늘릴 수 없어요.` };
        }
      }
      const k = legacyKey(r.name, dq);
      const isOrig = !p && (origCount.get(k) ?? 0) > 0;
      if (isOrig) origCount.set(k, (origCount.get(k) ?? 0) - 1);
      const attachable = cartQty === undefined && !isOrig;
      if (ownerRestricted && attachable) {
        if (!p && category === "TOOL" && r.inventoryItemId) p = byInv.get(r.inventoryItemId);
        if (!p && r.name) p = byName.get(r.name.trim());
      }
      r.planItemId = p?.id ?? "";
      if (p && category === "TOOL" && p.inventoryItemId) r.inventoryItemId = p.inventoryItemId;
    }
    // 편성 줄 수량은 정수만(합계·남은 수량·담기원장이 모두 정수로 센다)
    const badPlanQty = items.find((r) => r.planItemId && !/^[1-9]\d*$/.test(displayQty(r.qty)));
    if (badPlanQty) return { error: `‘${badPlanQty.name}’은(는) 편성 품목이라 수량을 1 이상의 정수로 넣어 주세요.` };
  } else {
    for (const r of items) r.planItemId = "";
  }
  // 재고 번호는 공구 줄만
  if (category !== "TOOL") for (const r of items) r.inventoryItemId = "";

  const orderDate = kstDateOf(order.createdAt);
  // 픽업/수령방식은 발주 owner(점주) 역할 기준으로 처리(관리자 역할 아님)
  const pickupTime = await buildPickup(ownerRole, formData, orderDate);
  const ful = readFulfillment(ownerRole, formData);
  if (ful.error) return { error: ful.error };

  // AI 정리 — 채움채·공구·편성 줄은 이름 그대로(계산서 이름 차감·자동제출·편성 합계가 이름/번호 기준).
  // 나머지 자유 줄만 정리한다(편성 줄이 없으면 예전과 똑같이 전체 정리).
  const freeIdx =
    category === "TOFU" || category === "TOOL"
      ? []
      : items.map((r, i) => (r.planItemId ? -1 : i)).filter((i) => i >= 0);
  const clean: { name: string; qty: string; note: string }[] = items.map((r) => ({
    name: r.name,
    qty: r.qty,
    note: r.note,
  }));
  let engine: "claude" | "rule" = "rule";
  let summary =
    category === "TOFU"
      ? `채움채 발주 ${items.length}건`
      : category === "TOOL"
        ? `공구 발주 ${items.length}건`
        : [...new Set(items.map((it) => it.note).filter(Boolean))].join(" · ");
  if (freeIdx.length > 0) {
    const sub = freeIdx.map((i) => ({ name: items[i].name, qty: items[i].qty, note: items[i].note }));
    const result = await normalizeOrder({
      categoryLabel: CATEGORIES[category].label,
      items: sub,
      pickupTime: pickupTime || undefined,
    });
    summary = result.summary;
    if (result.items.length === sub.length) {
      engine = result.engine;
      freeIdx.forEach((idx, j) => {
        const it = result.items[j];
        clean[idx] = { name: it?.name ?? sub[j].name, qty: it?.qty ?? sub[j].qty, note: it?.note ?? sub[j].note };
      });
    }
  }
  const rawText = rowsRawText(items);

  // 편성 줄 최종 수량(같은 번호 여러 줄은 합산) — 잠그고 상한 확인(관리자는 넘어도 저장, 경고만)
  const planQty = new Map<string, number>();
  for (const r of items) {
    if (!r.planItemId) continue;
    planQty.set(r.planItemId, (planQty.get(r.planItemId) ?? 0) + parsePlanQty(r.qty));
  }
  const lines: PlanLineInput[] = [...planQty.entries()].map(([planItemId, qty]) => ({ planItemId, qty }));

  type Out = { kind: "ok"; warnings: PlanIssue[] } | { kind: "plan"; issues: PlanIssue[] };
  let out: Out;
  try {
    out = await runOrderTx<Out>(async (tx) => {
      // 잠금 순서: 지점 → 편성 품목 줄 → 연동 재고(lockAndCheckPlanLines 안). 편성 줄이 없으면 바로 끝남.
      await lockStore(tx, order.userId);
      const chk = await lockAndCheckPlanLines(tx, {
        userId: order.userId,
        windowKey: W,
        lines,
        replaceOrderIds: [orderId],
        asAdmin: true,
      });
      if (!chk.ok) return { kind: "plan", issues: chk.issues };

      await tx.orderItem.deleteMany({ where: { orderId } });
      await tx.order.update({
        where: { id: orderId },
        data: {
          pickupTime: pickupTime || null,
          fulfillment: ful.value,
          rawText,
          aiSummary: summary,
          aiProcessed: true,
          aiEngine: engine,
          edited: true,
          editedAt: new Date(),
          confirmed: false,
          confirmedAt: null,
          windowKey: W,
          items: {
            create: items.map((r, i) => ({
              sortOrder: i,
              rawName: r.name,
              rawQty: r.qty,
              rawNote: r.note,
              name: clean[i]?.name ?? r.name,
              qty: displayQty(clean[i]?.qty ?? r.qty),
              note: clean[i]?.note ?? r.note,
              planItemId: r.planItemId,
              inventoryItemId: r.inventoryItemId,
            })),
          },
        },
      });
      if (category === "TOOL") await syncPlanHolds(tx, order.userId, W);
      return { kind: "ok", warnings: chk.warnings };
    });
  } catch (err) {
    console.error("[order] admin update failed:", err);
    return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }
  if (out.kind === "plan") {
    const st = planIssuesState(out.issues);
    return { error: `${st.error} (편성이 바뀌었을 수 있어요. 새로고침 후 다시 해 주세요.)` };
  }
  // 관리자 초과 허용 — 경고 문구(품목별 한 줄)
  const warnText = [...new Map(out.warnings.map((w) => [w.planItemId, w])).values()]
    .map((w) => `‘${w.name}’ ${w.message}`)
    .join(" / ");

  // 수령 방식은 그날 그 점주 발주 전체에 동일 적용
  if (needsFulfillment(ownerRole)) {
    try {
      const { start, end } = kstDayRange(orderDate);
      await prisma.order.updateMany({
        where: {
          userId: order.userId,
          id: { not: orderId },
          createdAt: { gte: start, lt: end },
          status: { not: "CANCELLED" },
        },
        data: { fulfillment: ful.value },
      });
    } catch (e) {
      logError("order.adminFulfillmentSync", e, { userId: order.userId, orderId });
    }
  }

  await writeAudit({
    action: "order.adminEdit",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Order",
    targetId: orderId,
    summary:
      `${order.user.storeName} · ${CATEGORIES[category].label} 발주 수정(관리자)` +
      (warnText ? ` · 편성 상한 초과 허용: ${warnText}` : ""),
    ...(out.warnings.length > 0 ? { snapshot: { windowKey: W, warnings: out.warnings } } : {}),
  });
  // 점주 + 받는 업체에 '발주 수정' 알림
  await notifyMerchantOrderEdited(order.userId);
  await notifyVendorOrderEdited(vendorRoleForCategory(category), order.user.storeName);

  // 경고는 발주서 화면 상단에 띄운다(저장은 이미 끝남)
  redirect(
    `/admin/orders/${orderId}?edited=1` +
      (warnText ? `&warn=${encodeURIComponent(warnText.slice(0, 400))}` : ""),
  );
}

// ============================================================
//  점주 '발주 수정'(통합) — 그 날짜의 전 카테고리를 한 폼에서 upsert.
//  안 넣었던 종류를 여기서 추가할 수 있어 별도 '발주 추가' 화면을 대체한다.
//  · 종류별로: 기존 발주 있으면 수정, 없으면 신규 생성. payload에 없는 종류는 그대로 둔다
//    (품목을 통째로 비워 저장해도 그 종류는 유지 — 종류 제거는 기존 '발주 취소'로).
//  · 공구(TOOL)는 클라 payload 무시하고 담기원장(myHolds)으로 재구성(담기↔주문 정합).
//  · 창/미수/계산서발행 게이트는 단일 수정과 동일.
// ============================================================
export async function updateDayOrderAction(
  _prev: OrderFormState,
  formData: FormData,
): Promise<OrderFormState> {
  const user = await requireMerchant();
  if (needsOnboarding(user)) return { error: "오픈 준비를 먼저 완료해 주세요." };
  const date = normalizeDateStr(String(formData.get("date") ?? ""));
  if (!date) return { error: "잘못된 요청이에요." };

  // 발주 운영시간 가드(강제오픈·지점 1회 열기 포함 — 새 발주와 같은 판정)
  if (!(await orderTimeOpenForUser(user))) {
    return {
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  // 1일 미수 잠금
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 발주가 잠겨 있어요. 입금 확인 후 가능해요." };
  }

  // 수정 범위 — 핫딜마켓 가맹점은 '발주창 K'(평일=그날, 토·일=토요일 한 창) 단위로 묶는다.
  // 달력 하루로 찾으면 주말 토·일이 갈려 같은 창에 같은 종류 발주가 2건 생겼다(9/26·27 실사례).
  // 소매(창 없음)는 종전대로 그 날짜 하루.
  const windowed = hasOrderWindow(user.role);
  const K = windowed ? normalizeWindowKey(date) : date;
  const scopeWhere = (): Prisma.OrderWhereInput => {
    if (windowed) return windowOrdersWhere(user.id, K);
    const { start, end } = kstDayRange(date);
    return { userId: user.id, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } };
  };
  const existingSelect = {
    id: true,
    category: true,
    createdAt: true,
    confirmed: true,
    items: {
      orderBy: { sortOrder: "asc" },
      select: {
        rawName: true,
        rawQty: true,
        rawNote: true,
        name: true,
        qty: true,
        note: true,
        planItemId: true,
        inventoryItemId: true,
      },
    },
  } satisfies Prisma.OrderSelect;

  // 그 창(날짜)의 기존 발주(취소 제외). 반드시 존재해야 함(이 화면은 '기존 날짜 수정' 전용).
  // orderBy로 종류별 '첫 건'을 결정적으로 고정(같은 종류 중복 Order 정리 기준). items는 변경 diff용.
  const existing = await prisma.order.findMany({
    where: scopeWhere(),
    orderBy: { createdAt: "asc" },
    select: existingSelect,
  });
  if (existing.length === 0) return { error: "수정할 발주가 없어요." };

  // 이번 발주창 소속만 수정 가능(핫딜마켓) — 지난 창(이미 출고 준비) 발주 차단.
  // 수정은 정규 발주 시간(12~20시)에만 — 강제오픈·1회 열기로 20시 뒤에 고치면 20:05 자동제출이 끝난
  // 채움채 수량과 앱 발주서가 어긋난다(예전 기준 그대로 유지).
  if (windowed && !isOrderOpen()) {
    return { error: `지금은 수정 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL})` };
  }
  if (windowed && K !== windowKeyAt()) {
    return { error: "지난 발주는 수정할 수 없어요. 본사에 문의해 주세요." };
  }

  // 계산서 발행분은 잠금(청구액↔발주 정합). Invoice.date=출고일 기준.
  const issuedInv = await prisma.invoice.findFirst({
    where: {
      userId: user.id,
      kind: "DAILY",
      date: shipmentDayOf(K),
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  if (issuedInv) {
    return { error: "입금요청서가 발행된 발주는 수정할 수 없어요. 본사에 문의해 주세요." };
  }

  // 품목 제한 모드 — 저장 판정(설정을 못 읽으면 거절) + 화면 표식 확인
  const restricted = await strictRestricted(user);
  if (restricted === null) return { error: RETRY_LATER };
  const stampErr = stampError(String(formData.get("restrictStamp") ?? ""), restricted, K);
  if (stampErr) return { error: stampErr };

  const allowed = allowedCategoriesFor(user.role);
  // 발주 방식 설정 — 과일/야채 품목 고정 설정(수정 경로도 지정 품목명 보존·검증)
  const channelCfg = await orderChannelConfig();

  // payload: 멀티 카테고리(공구는 여기서 무시 — 꺼짐은 담기원장, 제한 모드는 planLines 로 재구성)
  let payload: { category?: string; items?: RawRow[] }[] = [];
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    payload = [];
  }
  if (!Array.isArray(payload)) payload = [];

  const pickupTime = await buildPickup(user.role, formData, date);
  const ful = readFulfillment(user.role, formData);
  if (ful.error) return { error: ful.error };

  // 기존 발주 id 묶음 — 트랜잭션 안에서 다시 읽어 달라졌으면(다른 화면·기기에서 바뀜) 저장하지 않는다.
  const snapIds = existing.map((o) => o.id).sort().join(",");

  type DayOut =
    | { kind: "ok"; createdCats: Category[]; editedCats: Category[]; placed: number }
    | { kind: "stale" }
    | { kind: "plan"; issues: PlanIssue[] }
    | { kind: "confirmed"; category: Category }
    | { kind: "empty" };

  let out: DayOut;
  if (restricted) {
    const r = await prepareRestrictedDay({ formData, payload, allowed, K, existing });
    if ("error" in r) return { error: r.error };
    try {
      out = await runOrderTx<DayOut>(async (tx) => {
        await lockStore(tx, user.id);
        const ex = await tx.order.findMany({ where: scopeWhere(), orderBy: { createdAt: "asc" }, select: existingSelect });
        if (ex.map((o) => o.id).sort().join(",") !== snapIds) return { kind: "stale" };

        // 모드 전에 담아 두고 발주엔 안 쓴 재고현황 담기는 풀어 준다(옛 담기 발주 줄이 가리키는 담기는 유지).
        await releaseOrphanCartHolds(tx, user.id, K);
        // 편성 세 종류 발주를 통째로 다시 쓴다 → 그 발주들 안의 기존 편성 줄은 '내 기존 수량'(줄이기·그대로는 항상 허용)
        const replaceOrderIds = ex.filter((o) => isPlanCat(o.category)).map((o) => o.id);
        const chk = await lockAndCheckPlanLines(tx, {
          userId: user.id,
          windowKey: K,
          lines: r.lines,
          replaceOrderIds,
        });
        if (!chk.ok) return { kind: "plan", issues: chk.issues };

        const prepared: DayPrepared[] = [];
        const deleteCats: Category[] = [];
        for (const c of PLAN_CATS) {
          const orders = ex.filter((o) => o.category === c);
          // 편성 번호 없는 옛 줄(모드 전에 넣은 자유 줄)은 그대로 보존(화면은 읽기 전용)
          const legacy = orders.flatMap((o) => o.items).filter((it) => !it.planItemId);
          const planLines = chk.resolved.filter((l) => l.category === c);
          if (planLines.length > 0 && !allowed.includes(c)) return { kind: "stale" };
          const rows: ItemRowData[] = [
            ...planItemRows(planLines),
            ...legacy.map((it, i) => ({ ...it, sortOrder: planLines.length + i })),
          ];
          if (rows.length === 0) {
            if (orders.length === 0) continue;
            // 그 종류를 비움 → 그 종류 발주 삭제. 업자가 이미 '발주 확인'했으면 삭제 대신 취소 요청으로.
            if (orders.some((o) => o.confirmed)) return { kind: "confirmed", category: c };
            deleteCats.push(c);
            continue;
          }
          prepared.push({
            category: c,
            rawText: rowsRawText(rows),
            summary: c === "TOOL" ? `공구 발주 ${rows.length}건` : "",
            engine: "rule",
            itemRows: rows,
          });
        }
        if (r.tofu) prepared.push(r.tofu);
        else if (allowed.includes("TOFU")) {
          // 채움채 칸을 모두 비움 → 편성 종류와 똑같이 그 발주 삭제(안 지우면 20:05 자동제출로 그대로 나간다).
          const tofuOrders = ex.filter((o) => o.category === "TOFU");
          if (tofuOrders.length > 0) {
            if (tofuOrders.some((o) => o.confirmed)) return { kind: "confirmed", category: "TOFU" };
            deleteCats.push("TOFU");
          }
        }
        // 전부 비우면 저장 대신 취소 요청으로(수정 화면이 발주 취소 통로가 되지 않게)
        if (prepared.length === 0) return { kind: "empty" };

        const res = await applyDayPrepared(tx, {
          userId: user.id,
          windowKey: K,
          backfillKey: K,
          existing: ex,
          prepared,
          deleteCats,
          common: { pickupTime: pickupTime || null, fulfillment: ful.value },
        });
        // 연동 공구 발주분 → 담기원장(PLAN) 맞춤(같은 트랜잭션, 현재 창만)
        await syncPlanHolds(tx, user.id, K);
        return { kind: "ok", ...res };
      });
    } catch (err) {
      console.error("[order] restricted day update failed:", err);
      return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
    }
  } else {
    // ── 꺼짐(기존 동작) ──────────────────────────────────────
    const groups: Group[] = [];
    for (const g of payload) {
      const category = String(g.category ?? "") as Category;
      if (!allowed.includes(category) || category === "TOOL") continue;
      const items = cleanItems(Array.isArray(g.items) ? g.items : []);
      if (items.length === 0) continue;
      if (!items.some((r) => r.name)) {
        return { error: `${CATEGORIES[category].label} 품목명을 입력하세요.` };
      }
      const badQty = findBadQtyItem(items);
      if (badQty) return { error: `‘${badQty}’ 수량을 입력해 주세요.` };
      groups.push({ category, items });
    }
    remapBenijimin(groups, channelCfg.fixedFruit); // #5 베니지민 고구마 → 과일(과일 고정 시 이동 보류)
    remapGoguma(groups, channelCfg.fixedVeg); // 고구마는 무조건 야채(야채 고정 시 이동 보류)
    mergeSameItems(groups); // R1 같은 품목+설명 합산

    // 칸 발주 잠금(gridDisabled) 시 편집 경로로 '새 카테고리' 신규 생성 우회 차단(기존 카테고리 수정은 허용).
    const { gridDisabled } = effectiveChannels(channelCfg);
    if (gridDisabled) {
      const existingCats = new Set(existing.map((o) => o.category));
      const newCat = groups.find((g) => !existingCats.has(g.category));
      if (newCat) {
        return { error: "지금은 칸 발주로 새 품목을 추가할 수 없어요." };
      }
    }

    // 품목 고정 카테고리 — 관리자 지정 품목만 허용(remap 이후). 발주창 중 관리자가 미노출/개명해도
    // '이미 발주된 품목명'은 보존(extraAllow)해 무경고 삭제를 막고, 지정 외 채워진 품목은 오류로 차단.
    if (channelCfg.fixedFruit || channelCfg.fixedVeg) {
      const extraAllow = { FRUIT: new Set<string>(), VEG: new Set<string>() };
      for (const o of existing) {
        if (o.category === "FRUIT" || o.category === "VEG") {
          for (const it of o.items) extraAllow[o.category].add(normFixedName(it.name));
        }
      }
      const dropped = enforceFixedWhitelist(
        groups,
        channelCfg,
        await fixedNameSets(),
        extraAllow,
      );
      if (dropped) {
        return {
          error: `‘${dropped}’은(는) 지금 발주할 수 없어요. 새로고침 후 다시 시도해 주세요.`,
        };
      }
    }

    // 공구(TOOL) = 담기원장(재고현황에서 담은 것)으로 재구성. 담은 게 없으면 공구는 손대지 않음(그대로 둠).
    // 기존 공구 발주의 편성 줄(planItemId — 모드를 끈 직후 같은 창)은 담기에 없으니 지우지 않고 앞에 보존.
    const holds = await cartHolds(user.id, windowKeyAt());
    const keptToolPlan = existing
      .filter((o) => o.category === "TOOL")
      .flatMap((o) => o.items)
      .filter((it) => it.planItemId);

    if (groups.length === 0 && holds.length === 0) {
      return { error: "발주할 품목을 한 개 이상 입력하세요." };
    }

    // 채팅/칸 미리보기(previewGridOrderAction)에서 이미 정리·확인했으면 재정규화 생략.
    const preNormalized = String(formData.get("preNormalized") ?? "") === "1";

    // 비-공구 그룹 정규화(TOFU는 원본 보존). createOrderAction과 동일 규칙.
    const normalized = await Promise.all(
      groups.map((g) => {
        if (g.category === "TOFU") {
          return Promise.resolve({
            engine: "rule" as const,
            items: g.items,
            summary: `채움채 발주 ${g.items.length}건`,
          });
        }
        if (isFixedCategory(g.category, channelCfg)) {
          // 품목 고정 — 관리자 지정 품목명 그대로 보존(AI 개명 금지)
          const noteTags = [...new Set(g.items.map((it) => it.note).filter(Boolean))];
          return Promise.resolve({
            engine: "rule" as const,
            items: g.items,
            summary: noteTags.join(" · "),
          });
        }
        if (preNormalized) {
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

    // 기존 편성 줄과 이름이 같은 줄은 편성 번호 유지(모드를 끈 직후 같은 창 — 다시 켜도 합계가 맞게)
    const planRefByCatName = new Map<string, string>();
    for (const o of existing) {
      for (const it of o.items) if (it.planItemId) planRefByCatName.set(`${o.category}|${it.name}`, it.planItemId);
    }

    // 카테고리별 저장용 데이터 산출(create/update 공용)
    const prepared: DayPrepared[] = groups.map((g, gi) => {
      const result = normalized[gi];
      const aligned = result.items.length === g.items.length;
      const clean = aligned ? result.items : g.items;
      const engine = aligned ? result.engine : "rule";
      return {
        category: g.category,
        rawText: rowsRawText(g.items),
        summary: result.summary,
        engine,
        itemRows: g.items.map((r, i) => {
          const name = clean[i]?.name ?? r.name;
          return {
            sortOrder: i,
            rawName: r.name,
            rawQty: r.qty,
            rawNote: r.note,
            name,
            qty: displayQty(clean[i]?.qty ?? r.qty),
            note: clean[i]?.note ?? r.note,
            planItemId: planRefByCatName.get(`${g.category}|${name}`) ?? "",
          };
        }),
      };
    });

    // 공구 그룹(보존 편성 줄 + 담기원장, 정규화 없음 — 이름 보존)
    if (holds.length > 0) {
      const toolRows: ItemRowData[] = [
        ...keptToolPlan.map((it, i) => ({ ...it, sortOrder: i })),
        ...holds.map((h, i) => {
          const qty = String(h.qty);
          return {
            sortOrder: keptToolPlan.length + i,
            rawName: h.name,
            rawQty: qty,
            rawNote: "",
            name: h.name,
            qty: displayQty(qty),
            note: "",
            inventoryItemId: h.itemId,
          };
        }),
      ];
      prepared.push({
        category: "TOOL",
        rawText: toolRows.map((r, i) => `${i + 1}. ${r.name} ${r.qty}`).join("\n"),
        summary: `공구 발주 ${toolRows.length}건`,
        engine: "rule",
        itemRows: toolRows,
      });
    }

    try {
      out = await runOrderTx<DayOut>(async (tx) => {
        // 지점 잠금 → 그 창 발주를 다시 읽어 그대로인지 확인(새 종류 중복 생성 경쟁 방지) → 저장
        await lockStore(tx, user.id);
        const ex = await tx.order.findMany({ where: scopeWhere(), orderBy: { createdAt: "asc" }, select: existingSelect });
        if (ex.map((o) => o.id).sort().join(",") !== snapIds) return { kind: "stale" };
        const res = await applyDayPrepared(tx, {
          userId: user.id,
          windowKey: windowed ? K : windowKeyAt(),
          backfillKey: windowed ? K : null,
          existing: ex,
          prepared,
          deleteCats: [],
          common: { pickupTime: pickupTime || null, fulfillment: ful.value },
        });
        return { kind: "ok", ...res };
      });
    } catch (err) {
      console.error("[order] day update failed:", err);
      return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
    }
  }

  if (out.kind === "stale") {
    return { error: "발주가 방금 다른 화면에서 바뀌었어요. 새로고침 후 다시 해 주세요." };
  }
  if (out.kind === "plan") return planIssuesState(out.issues);
  if (out.kind === "confirmed") {
    return {
      error: `${CATEGORIES[out.category].label} 발주는 업체가 이미 확인했어요. 전부 빼려면 ‘발주 취소 요청’으로 진행해 주세요.`,
    };
  }
  if (out.kind === "empty") {
    return { error: "발주할 품목을 한 개 이상 넣어 주세요. 모두 빼려면 ‘발주 취소 요청’으로 진행해 주세요." };
  }

  // 수령 방식은 그 창(날짜) 발주 전체에 동일 적용(안 건드린 종류까지). confirmed는 건드리지 않음.
  if (needsFulfillment(user.role)) {
    try {
      await prisma.order.updateMany({
        where: scopeWhere(),
        data: { fulfillment: ful.value },
      });
    } catch (e) {
      logError("order.dayFulfillmentSync", e, { userId: user.id, date });
    }
  }

  // 알림 — 새로 추가된 종류는 '새 발주', 내용이 바뀐(빠진 종류 포함) 종류만 '발주 수정'. 변경 없는 종류는 알림 없음.
  const { createdCats, editedCats, placed } = out;
  const createdVendors = [...new Set(createdCats.map(vendorRoleForCategory))];
  const editedVendors = [...new Set(editedCats.map(vendorRoleForCategory))];
  await Promise.all(createdVendors.map((r) => notifyVendorNewOrder(r, user.storeName)));
  await Promise.all(editedVendors.map((r) => notifyVendorOrderEdited(r, user.storeName)));
  if (createdCats.length > 0) await notifyAdminNewOrder(user.storeName);
  if (editedCats.length > 0) await notifyAdminOrderEdited(user.storeName);
  if (createdCats.length > 0) await notifyMerchantOrderPlaced(user.id, placed);

  redirect(`/order/day/${date}?edited=1`);
}

// 하루 수정 — 종류별 저장 데이터(create/update 공용)
type DayPrepared = {
  category: Category;
  rawText: string;
  summary: string;
  engine: "claude" | "rule";
  itemRows: ItemRowData[];
};

type DayExisting = {
  id: string;
  category: string;
  items: { name: string; qty: string; note: string; planItemId: string; inventoryItemId: string }[];
};

/**
 * 하루 수정 저장(트랜잭션 안) — 종류별 upsert.
 * 없던 종류=생성(발주창 키 저장), 있고 내용이 바뀐 종류=수정(확정해제·알림), 내용이 그대로면 손대지 않음
 * (그 업체 확정·알림 유지). 같은 종류 중복 Order(레이스 잔재)는 첫 건만 남기고 나머지 삭제(정리).
 * deleteCats: 제한 모드에서 점주가 비운 종류 — 그 종류 발주 삭제.
 */
async function applyDayPrepared(
  tx: Tx,
  args: {
    userId: string;
    windowKey: string; // 새로 만드는 종류에 저장할 창 키
    backfillKey: string | null; // 수정하는 발주의 창 키(레거시 null 채우기). null=건드리지 않음(소매)
    existing: DayExisting[];
    prepared: DayPrepared[];
    deleteCats: Category[];
    common: { pickupTime: string | null; fulfillment: string | null };
  },
): Promise<{ createdCats: Category[]; editedCats: Category[]; placed: number }> {
  const { userId, windowKey, backfillKey, existing, prepared, deleteCats, common } = args;
  const existingByCat = new Map<string, { id: string; items: DayExisting["items"]; extraIds: string[] }>();
  for (const o of existing) {
    const cur = existingByCat.get(o.category);
    if (!cur) existingByCat.set(o.category, { id: o.id, items: o.items, extraIds: [] });
    else cur.extraIds.push(o.id); // 같은 종류 중복 → 정리 대상
  }
  // 편성 번호 없는 줄은 순서대로(기존 그대로), 편성 줄은 순서와 상관없이 비교 — 관리자가 편성 순서만 바꿔도
  // 손대지 않은 종류가 '수정됨'이 되어 업체 확인이 풀리고 수정 알림이 가던 것을 막는다.
  const freeSame = (a: DayExisting["items"], b: DayExisting["items"]) =>
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.name === b[i].name &&
        String(x.qty) === String(b[i].qty) &&
        (x.note ?? "") === (b[i].note ?? "") &&
        // 기존 줄에 재고 번호가 없던 레거시 공구 줄은 번호만 다르다고 '수정'으로 보지 않는다(불필요한 확정 해제·알림 방지)
        (!b[i].inventoryItemId || (x.inventoryItemId ?? "") === b[i].inventoryItemId),
    );
  const planKeys = (list: DayExisting["items"]) =>
    list
      .filter((x) => x.planItemId)
      .map((x) => JSON.stringify([x.planItemId, x.name, String(x.qty), x.note ?? "", x.inventoryItemId ?? ""]))
      .sort();
  const sameItems = (a: DayExisting["items"], b: DayExisting["items"]) => {
    const pa = planKeys(a);
    const pb = planKeys(b);
    return (
      pa.length === pb.length &&
      pa.every((k, i) => k === pb[i]) &&
      freeSame(
        a.filter((x) => !x.planItemId),
        b.filter((x) => !x.planItemId),
      )
    );
  };

  const createdCats: Category[] = [];
  const editedCats: Category[] = [];
  let placed = 0;
  for (const c of deleteCats) {
    const ex = existingByCat.get(c);
    if (!ex) continue;
    // OrderItem 은 Cascade 로 함께 삭제
    await tx.order.deleteMany({ where: { id: { in: [ex.id, ...ex.extraIds] } } });
    editedCats.push(c);
  }
  for (const p of prepared) {
    const data = {
      pickupTime: common.pickupTime,
      fulfillment: common.fulfillment,
      rawText: p.rawText,
      aiSummary: p.summary,
      aiProcessed: true,
      aiEngine: p.engine,
    };
    const ex = existingByCat.get(p.category);
    if (ex && ex.extraIds.length > 0) {
      // 같은 종류 중복(레이스) 정리 — 첫 건 외 삭제
      await tx.orderItem.deleteMany({ where: { orderId: { in: ex.extraIds } } });
      await tx.order.deleteMany({ where: { id: { in: ex.extraIds } } });
    }
    if (ex) {
      const newItems = p.itemRows.map((r) => ({
        name: r.name,
        qty: r.qty,
        note: r.note,
        planItemId: r.planItemId ?? "",
        inventoryItemId: r.inventoryItemId ?? "",
      }));
      if (sameItems(newItems, ex.items)) continue; // 변경 없음 → 확정·알림 유지
      editedCats.push(p.category);
      await tx.orderItem.deleteMany({ where: { orderId: ex.id } });
      await tx.order.update({
        where: { id: ex.id },
        data: {
          ...data,
          ...(backfillKey ? { windowKey: backfillKey } : {}), // 레거시(키 없음) 발주는 이참에 창 키를 채운다
          edited: true,
          editedAt: new Date(),
          confirmed: false,
          confirmedAt: null,
          items: { create: p.itemRows },
        },
      });
      continue;
    }
    createdCats.push(p.category);
    placed += p.itemRows.length;
    await tx.order.create({
      data: {
        userId,
        category: p.category,
        vendorRole: vendorRoleForCategory(p.category),
        windowKey,
        ...data,
        items: { create: p.itemRows },
      },
      select: { id: true },
    });
  }
  return { createdCats, editedCats, placed };
}

// 제한 모드 하루 수정 — 폼 검사(트랜잭션 밖): planLines·채움채(보이는 목록 + 그 창에 이미 넣은 이름).
async function prepareRestrictedDay(args: {
  formData: FormData;
  payload: { category?: string; items?: RawRow[] }[];
  allowed: Category[];
  K: string;
  existing: DayExisting[];
}): Promise<{ error: string } | { lines: PlanLineInput[]; tofu: DayPrepared | null }> {
  const { formData, payload, allowed, K, existing } = args;
  const pl = parsePlanLines(formData.get("planLines"));
  if (!pl.ok) return { error: pl.error };
  // 빠진 줄 = 0 = 삭제이므로, planLines 칸 자체가 없으면(옛 화면·화면 오류) 저장하지 않는다(전부 지워지는 사고 방지).
  if (!pl.present) return { error: STAMP_CHANGED };

  let tofu: DayPrepared | null = null;
  if (allowed.includes("TOFU")) {
    let tofuItems: Group["items"] = [];
    for (const g of payload) {
      if (String(g.category ?? "") !== "TOFU") continue;
      tofuItems = cleanItems(Array.isArray(g.items) ? g.items : []);
    }
    if (tofuItems.length > 0) {
      if (!tofuItems.some((r) => r.name)) return { error: `${CATEGORIES.TOFU.label} 품목명을 입력하세요.` };
      const badQty = findBadQtyItem(tofuItems);
      if (badQty) return { error: `‘${badQty}’ 수량을 입력해 주세요.` };
      const plan = await getDayPlan(K);
      const visible = new Set(visibleTofuCatalog(plan.tofu.hiddenSeqs).map((p) => p.name));
      const ok = new Set(visible);
      // 그 창에 이미 발주한 채움채 이름은 숨겨졌어도 유지·줄이기 가능(extraAllow) — 늘리기는 안 됨
      const oldQty = new Map<string, number>();
      for (const o of existing) {
        if (o.category !== "TOFU") continue;
        for (const it of o.items) {
          ok.add(it.name);
          oldQty.set(it.name, (oldQty.get(it.name) ?? 0) + qtyNum(it.qty));
        }
      }
      const bad = tofuItems.find((it) => it.name && !ok.has(it.name));
      if (bad) return { error: `‘${bad.name}’는 지금 발주할 수 없어요. 새로고침 후 다시 시도해 주세요.` };
      tofuItems = tofuItems.filter((it) => it.name);
      const newQty = new Map<string, number>();
      for (const it of tofuItems) newQty.set(it.name, (newQty.get(it.name) ?? 0) + qtyNum(displayQty(it.qty)));
      for (const [name, q] of newQty) {
        if (visible.has(name)) continue;
        const old = Math.round((oldQty.get(name) ?? 0) * 100) / 100;
        if (q > old) {
          return { error: `‘${name}’은(는) 판매가 끝난 품목이라 더 늘릴 수 없어요. 지금 수량(${old}개) 이하로 넣어 주세요.` };
        }
      }
      tofu = {
        category: "TOFU",
        rawText: rowsRawText(tofuItems),
        summary: `채움채 발주 ${tofuItems.length}건`,
        engine: "rule",
        itemRows: tofuItems.map((r, i) => ({
          sortOrder: i,
          rawName: r.name,
          rawQty: r.qty,
          rawNote: r.note,
          name: r.name,
          qty: displayQty(r.qty),
          note: r.note,
        })),
      };
    }
  }

  const hasPlanOrders = existing.some((o) => isPlanCat(o.category));
  if (pl.lines.length === 0 && !tofu && !hasPlanOrders) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }
  return { lines: pl.lines, tofu };
}
