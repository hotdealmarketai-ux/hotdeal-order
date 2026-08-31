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
import { currentWindowStartUtc } from "@/lib/schedule";
import { displayQty } from "@/lib/qty";
import { orderOpenNow } from "@/lib/order-open";
import {
  orderChannelConfig,
  effectiveChannels,
  fixedNameSets,
  isFixedCategory,
  normFixedName,
  type OrderChannelConfig,
} from "@/lib/order-flags";
import { logError } from "@/lib/log";
import { orderLockOf } from "@/lib/receivable";
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

  // 일반 발주 관리 — 채팅 발주 잠금(관리자 설정 또는 품목 고정 시 자동)
  if (effectiveChannels(await orderChannelConfig()).chatDisabled) {
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
  remapGoguma(groups); // 고구마는 무조건 과일

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

  // 일반 발주 관리 — 칸 발주 잠금(관리자 설정)
  const channelCfg = await orderChannelConfig();
  if (effectiveChannels(channelCfg).gridDisabled) {
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
  for (const g of payload) {
    const category = String(g.category ?? "") as Category;
    if (!allowed.includes(category)) continue;
    const items = cleanItems(Array.isArray(g.items) ? g.items : []);
    if (items.length === 0) continue;
    groups.push({ category, items });
  }

  remapBenijimin(groups, channelCfg.fixedFruit); // #5 베니지민 고구마 → 과일(과일 고정 시 이동 보류)

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

  // 품목 고정 카테고리로의 유입을 막기 위한 고정 집합(고정 카탈로그로 remap돼 유실되는 문제 차단).
  const fixedSet = new Set<"FRUIT" | "VEG">();
  if (channelCfg.fixedFruit) fixedSet.add("FRUIT");
  if (channelCfg.fixedVeg) fixedSet.add("VEG");
  // R6: 매장 취급 목록 기준으로 과일↔야채 교차 재분류(AI가 이름을 매장 이름으로 맞춘 뒤).
  reclassifyByCatalog(outGroups, allowed as Category[], fixedSet);
  // Q1: 정규화(AI) 이후 최종적으로 한 번 더 remap — AI가 '베니지민 고구마'로 합쳤어도 여기서
  // name="고구마"/note="베니지민"으로 다시 분리하고, 카테고리도 과일로 확정(미리보기가 최종과 일치).
  remapBenijimin(outGroups, channelCfg.fixedFruit);
  remapGoguma(outGroups, channelCfg.fixedFruit); // 고구마는 무조건 과일(단 과일 고정 시 이동 보류)
  mergeSameItems(outGroups); // R1 같은 품목+설명 합산

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

// 고구마는 무조건 '과일'로 라우팅(과일 파트/서부일광 출고) — 밤·자색·호박고구마 등 '고구마' 들어간 변형 포함.
// 야채로 분류/이동된 고구마를 과일로 되돌린다. 공구·두부칸(임의 상품명)·이미 과일칸은 건드리지 않음.
// reclassifyByCatalog·remapBenijimin 이후 마지막에 돌려 '무조건 과일'을 최종 확정한다(#고구마).
function remapGoguma(groups: Group[], fruitFixed = false): void {
  // 과일 품목 고정 ON이면 과일칸이 관리자 지정 카탈로그라 임의 고구마를 옮겨 담을 수 없다 →
  // 야채칸에 적힌 고구마는 그 자리에 그대로 둔다(무경고 유실 방지). 관리자가 고구마를 과일로 받으려면
  // 고정 과일 목록에 '고구마'를 등록하면 된다.
  if (fruitFixed) return;
  const moved: Group["items"] = [];
  for (const g of groups) {
    if (g.category !== "VEG") continue; // 야채칸의 고구마만 과일로(공구·두부·이미 과일은 그대로)
    const keep: Group["items"] = [];
    for (const it of g.items) {
      if (isGoguma(it.name)) moved.push(it);
      else keep.push(it);
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
  if (!(await orderOpenNow(user.role))) {
    return {
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  // 1일 미수 잠금 — 지난 미입금 계산서가 있으면 서버에서도 차단(UI 우회 방지)
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 발주가 잠겨 있어요. 입금 확인 후 가능해요." };
  }

  // 일반 발주 관리 — 발주 방식(칸/채팅) 잠금 서버 최종 검증(UI 우회 방지, fail-closed).
  // 잠긴 채널이 있으면 '허용된 채널의 source'가 명시된 요청만 통과(빈/미지 source 차단).
  // effectiveChannels가 칸·채팅 동시 잠금을 막으므로 정상 제출은 영향 없음.
  const channelCfg = await orderChannelConfig();
  const { gridDisabled, chatDisabled } = effectiveChannels(channelCfg);
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
  let orderedCats = new Set<string>();
  if (hasOrderWindow(user.role)) {
    // 관리자 강제오픈으로 '정오 이전'에 발주하면 currentWindowStartUtc(=오늘 12시)가 미래라
    // 방금 넣은 발주를 못 찾아 중복 방지가 통째로 무력화된다 → 창 시작과 '오늘 0시' 중
    // 이른 쪽을 기준으로 조회한다. (주말 연속창은 토 12시 < 일 0시라 그대로 유지)
    const since = new Date(
      Math.min(currentWindowStartUtc(), kstDayRange(kstToday()).start.getTime()),
    );
    const existing = await prisma.order.findMany({
      where: { userId: user.id, createdAt: { gte: since }, status: { not: "CANCELLED" } },
      select: { category: true },
    });
    orderedCats = new Set(existing.map((o) => o.category));
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
    // 공구(TOOL)는 예약발주 단일 소스 — 일일 발주로는 저장하지 않는다(담기 폐지, UI 우회 방지).
    if (category === "TOOL") continue;
    const items = cleanItems(Array.isArray(g.items) ? g.items : []);
    if (items.length === 0) continue;
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
  remapGoguma(groups, channelCfg.fixedFruit); // 고구마는 무조건 과일(과일 고정 시 이동 보류)
  mergeSameItems(groups); // R1 같은 품목+설명 합산

  // 품목 고정 카테고리 — 관리자 지정 품목만 허용(remap 이후 검증). 지정 외 품목이 채워져 있으면 저장 차단.
  if (channelCfg.fixedFruit || channelCfg.fixedVeg) {
    const dropped = enforceFixedWhitelist(groups, channelCfg, await fixedNameSets());
    if (dropped) {
      return { error: `‘${dropped}’은(는) 지정 품목이 아니에요. 지정 품목에서 선택해 주세요.` };
    }
  }

  if (groups.length === 0) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  // 이미 발주한 카테고리를 또 제출하면 거부(중복 방지). 안 넣었던 카테고리만 새로 추가된다(#6).
  const dupCat = groups.find((g) => orderedCats.has(g.category));
  if (dupCat) {
    return {
      error: `${CATEGORIES[dupCat.category].label}는 이번 발주 시간에 이미 넣었어요. '발주 수정'에서 고쳐 주세요.`,
    };
  }

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
        fulfillment: ful.value,
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

  // 공구(TOOL) 기준재고 차감은 발주 시점이 아니라 '매일 오후 8시 마감 정산'에서 일괄 처리한다
  // (개별 차감 누락 방지 — Order.stockDeductedAt 멱등). 담기(HELD)는 실시간 남은수량 표시용으로
  // 유지되며, 마감에 발주분은 정산·미발주분은 자동 해제된다. → src/lib/stock-hold.ts deductToolOrders

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
  if (needsOnboarding(user)) return { error: "오픈 준비를 먼저 완료해 주세요." };
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

  // '이번 발주창'에 넣은 발주만 수정 가능 — 창이 열려 있다고 지난 창(이미 업체로 나간) 발주까지
  // 고칠 수 있으면 실제 출고와 어긋난다.
  if (
    hasOrderWindow(user.role) &&
    order.createdAt.getTime() < currentWindowStartUtc()
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

  // 공구(TOOL)는 예약발주 단일 소스로 전환 — 재고현황 담기 폐지. 일일 발주(수정 포함)에서 공구는 다루지 않는다.
  // 레거시로 남아있는 공구 발주의 편집 진입은 명시적으로 차단(빈 담기로 인한 오류·유실 방지).
  if (category === "TOOL") {
    return { error: "공구는 예약발주에서만 관리해요. 이 발주는 수정할 수 없어요." };
  }
  let items: { name: string; qty: string; note: string }[];
  {
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

  // 채움채(TOFU)는 정규화 없이 정확한 이름 보존(공구 TOOL은 위에서 차단됨).
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
      user: { select: { role: true, storeName: true } },
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

  let parsed: RawRow[] = [];
  try {
    parsed = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    parsed = [];
  }
  const items = cleanItems(parsed);
  if (items.length === 0) return { error: "발주할 품목을 한 개 이상 입력하세요." };
  if (!items.some((r) => r.name)) return { error: "품목명을 입력하세요." };
  const badQtyItem = findBadQtyItem(items);
  if (badQtyItem) return { error: `‘${badQtyItem}’ 수량을 입력해 주세요.` };

  const orderDate = kstDateOf(order.createdAt);
  // 픽업/수령방식은 발주 owner(점주) 역할 기준으로 처리(관리자 역할 아님)
  const pickupTime = await buildPickup(ownerRole, formData, orderDate);
  const ful = readFulfillment(ownerRole, formData);
  if (ful.error) return { error: ful.error };

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
          fulfillment: ful.value,
          rawText,
          aiSummary: result.summary,
          aiProcessed: true,
          aiEngine: engine,
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
    console.error("[order] admin update failed:", err);
    return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

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
    summary: `${order.user.storeName} · ${CATEGORIES[category].label} 발주 수정(관리자)`,
  });
  // 점주 + 받는 업체에 '발주 수정' 알림
  await notifyMerchantOrderEdited(order.userId);
  await notifyVendorOrderEdited(vendorRoleForCategory(category), order.user.storeName);

  redirect(`/admin/orders/${orderId}?edited=1`);
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

  // 발주 운영시간 가드
  if (!(await orderOpenNow(user.role))) {
    return {
      error: `지금은 발주 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL} 발주 가능)`,
    };
  }

  // 1일 미수 잠금
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) {
    return { error: "지난 발주가 결제되지 않아 발주가 잠겨 있어요. 입금 확인 후 가능해요." };
  }

  // 그 날짜의 기존 발주(취소 제외). 반드시 존재해야 함(이 화면은 '기존 날짜 수정' 전용).
  // orderBy로 종류별 '첫 건'을 결정적으로 고정(같은 종류 중복 Order 정리 기준). items는 변경 diff용.
  const { start, end } = kstDayRange(date);
  const existing = await prisma.order.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      category: true,
      createdAt: true,
      items: {
        orderBy: { sortOrder: "asc" },
        select: { name: true, qty: true, note: true },
      },
    },
  });
  if (existing.length === 0) return { error: "수정할 발주가 없어요." };

  // 이번 발주창 소속만 수정 가능(핫딜마켓) — 지난 창(이미 출고 준비) 발주 차단.
  if (hasOrderWindow(user.role)) {
    if (!isOrderOpen()) {
      return { error: `지금은 수정 시간이 아니에요. (${ORDER_OPEN_LABEL} ~ ${ORDER_DEADLINE_LABEL})` };
    }
    if (existing.some((o) => o.createdAt.getTime() < currentWindowStartUtc())) {
      return { error: "지난 발주는 수정할 수 없어요. 본사에 문의해 주세요." };
    }
  }

  // 계산서 발행분은 잠금(청구액↔발주 정합). Invoice.date=출고일 기준.
  const issuedInv = await prisma.invoice.findFirst({
    where: {
      userId: user.id,
      kind: "DAILY",
      date: shipmentDayOf(date),
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  if (issuedInv) {
    return { error: "입금요청서가 발행된 발주는 수정할 수 없어요. 본사에 문의해 주세요." };
  }

  const allowed = allowedCategoriesFor(user.role);
  // 일반 발주 관리 — 과일/야채 품목 고정 설정(수정 경로도 지정 품목명 보존·검증)
  const channelCfg = await orderChannelConfig();

  // payload: 멀티 카테고리(공구는 여기서 무시 — 아래 myHolds로 재구성)
  let payload: { category?: string; items?: RawRow[] }[] = [];
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    payload = [];
  }
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
  remapGoguma(groups, channelCfg.fixedFruit); // 고구마는 무조건 과일(과일 고정 시 이동 보류)
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

  // 공구(TOOL)는 예약발주 단일 소스로 전환 — 일일 발주 수정에서 공구는 재구성하지 않는다(담기 폐지).
  if (groups.length === 0) {
    return { error: "발주할 품목을 한 개 이상 입력하세요." };
  }

  const pickupTime = await buildPickup(user.role, formData, date);
  const ful = readFulfillment(user.role, formData);
  if (ful.error) return { error: ful.error };

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

  // 카테고리별 저장용 데이터 산출(create/update 공용)
  type Prepared = {
    category: Category;
    rawText: string;
    summary: string;
    engine: "claude" | "rule";
    itemRows: {
      sortOrder: number;
      rawName: string;
      rawQty: string;
      rawNote: string;
      name: string;
      qty: string;
      note: string;
    }[];
  };
  const prepared: Prepared[] = groups.map((g, gi) => {
    const result = normalized[gi];
    const aligned = result.items.length === g.items.length;
    const clean = aligned ? result.items : g.items;
    const engine = aligned ? result.engine : "rule";
    const rawText = g.items
      .map((r, i) => `${i + 1}. ${[r.name, r.qty, r.note].filter(Boolean).join(" ")}`)
      .join("\n");
    return {
      category: g.category,
      rawText,
      summary: result.summary,
      engine,
      itemRows: g.items.map((r, i) => ({
        sortOrder: i,
        rawName: r.name,
        rawQty: r.qty,
        rawNote: r.note,
        name: clean[i]?.name ?? r.name,
        qty: displayQty(clean[i]?.qty ?? r.qty),
        note: clean[i]?.note ?? r.note,
      })),
    };
  });

  // (공구 TOOL 그룹 재구성 제거 — 공구는 예약발주 단일 소스로 전환, 일일 발주에서 다루지 않음)

  // 종류별 upsert — 없던 종류=생성, 있고 내용이 바뀐 종류=수정(확정해제·알림),
  // 내용이 그대로면 손대지 않음(그 업체 확정·알림 유지). 같은 종류 중복 Order(레이스 잔재)는
  // 첫 건만 남기고 나머지 삭제(정리). 변경 없는 종류를 재확정·재알림하던 문제 방지.
  const existingByCat = new Map<
    string,
    {
      id: string;
      items: { name: string; qty: string; note: string }[];
      extraIds: string[];
    }
  >();
  for (const o of existing) {
    const cur = existingByCat.get(o.category);
    if (!cur) existingByCat.set(o.category, { id: o.id, items: o.items, extraIds: [] });
    else cur.extraIds.push(o.id); // 같은 종류 중복 → 정리 대상
  }
  const sameItems = (
    a: { name: string; qty: string; note: string }[],
    b: { name: string; qty: string; note: string }[],
  ) =>
    a.length === b.length &&
    a.every(
      (x, i) =>
        x.name === b[i].name &&
        String(x.qty) === String(b[i].qty) &&
        (x.note ?? "") === (b[i].note ?? ""),
    );

  const createdCats: Category[] = [];
  const editedCats: Category[] = [];
  const ops = prepared.flatMap((p) => {
    const common = {
      pickupTime: pickupTime || null,
      fulfillment: ful.value,
      rawText: p.rawText,
      aiSummary: p.summary,
      aiProcessed: true,
      aiEngine: p.engine,
    };
    const ex = existingByCat.get(p.category);
    // 같은 종류 중복(레이스) 정리 — 첫 건 외 삭제
    const cleanup =
      ex && ex.extraIds.length > 0
        ? [
            prisma.orderItem.deleteMany({ where: { orderId: { in: ex.extraIds } } }),
            prisma.order.deleteMany({ where: { id: { in: ex.extraIds } } }),
          ]
        : [];
    if (ex) {
      const newItems = p.itemRows.map((r) => ({
        name: r.name,
        qty: r.qty,
        note: r.note,
      }));
      if (sameItems(newItems, ex.items)) return cleanup; // 변경 없음 → 확정·알림 유지
      editedCats.push(p.category);
      return [
        ...cleanup,
        prisma.orderItem.deleteMany({ where: { orderId: ex.id } }),
        prisma.order.update({
          where: { id: ex.id },
          data: {
            ...common,
            edited: true,
            editedAt: new Date(),
            confirmed: false,
            confirmedAt: null,
            items: { create: p.itemRows },
          },
        }),
      ];
    }
    createdCats.push(p.category);
    return [
      prisma.order.create({
        data: {
          userId: user.id,
          category: p.category,
          vendorRole: vendorRoleForCategory(p.category),
          ...common,
          items: { create: p.itemRows },
        },
      }),
    ];
  });

  if (ops.length > 0) {
    try {
      await prisma.$transaction(ops);
    } catch (err) {
      console.error("[order] day update failed:", err);
      return { error: "수정 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
    }
  }

  // 수령 방식은 그 날 발주 전체에 동일 적용(안 건드린 종류까지). confirmed는 건드리지 않음.
  if (needsFulfillment(user.role)) {
    try {
      await prisma.order.updateMany({
        where: {
          userId: user.id,
          createdAt: { gte: start, lt: end },
          status: { not: "CANCELLED" },
        },
        data: { fulfillment: ful.value },
      });
    } catch (e) {
      logError("order.dayFulfillmentSync", e, { userId: user.id, date });
    }
  }

  // 알림 — 새로 추가된 종류는 '새 발주', 내용이 바뀐 종류만 '발주 수정'. 변경 없는 종류는 알림 없음.
  const createdVendors = [...new Set(createdCats.map(vendorRoleForCategory))];
  const editedVendors = [...new Set(editedCats.map(vendorRoleForCategory))];
  await Promise.all(createdVendors.map((r) => notifyVendorNewOrder(r, user.storeName)));
  await Promise.all(editedVendors.map((r) => notifyVendorOrderEdited(r, user.storeName)));
  if (createdCats.length > 0) await notifyAdminNewOrder(user.storeName);
  if (editedCats.length > 0) await notifyAdminOrderEdited(user.storeName);
  if (createdCats.length > 0) {
    const placed = prepared
      .filter((p) => createdCats.includes(p.category))
      .reduce((n, p) => n + p.itemRows.length, 0);
    await notifyMerchantOrderPlaced(user.id, placed);
  }

  redirect(`/order/day/${date}?edited=1`);
}
