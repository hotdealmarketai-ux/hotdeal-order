// ============================================================
//  품목 제한 모드 — 날짜별 편성 + 저장 검사 엔진 (서버 전용)
//
//  편성: OrderPlan(날짜×종류) / OrderPlanItem(품목 줄). 날짜 = 발주창 키(windowKeyAt).
//  발주 줄: OrderItem.planItemId 로 편성 품목에 묶인다(이름 아님).
//
//  같은 숫자 같은 계산 — 점주 화면·실시간 조회·저장 검사·관리자 현황이 모두 이 파일의 계산을 쓴다.
//   · 전 지점 합계 = 취소 아닌 발주의 그 품목 줄 수량 합(매번 다시 셈, 따로 적어 두는 숫자 없음)
//   · 연동 공구 실재고 = 기준재고 − 이번 창 담기원장(StockHold) − 예약 홀드
//   · 남은 수량 = min(관리자 재고수량 − 합계, 실재고)   ← 사장님 결정: 실재고는 못 넘음
//
//  저장 검사(lockAndCheckPlanLines)는 반드시 트랜잭션 안에서:
//   지점 잠금(advisory) → 편성 품목 줄 잠금(id 순) → 연동 재고 잠금(id 순) → 합계 재계산 → 판정.
//   · 늘리는 것만 검사, 줄이기·그대로는 항상 허용(관리자가 중간에 한도를 줄여도 기존 발주 보존)
//   · 최소 수량(MOQ)은 수량이 바뀔 때만: 0 이거나 최소 이상
//   · 숨긴 품목은 기존 수량 이하만
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { CHAEUMCHAE_CATALOG, type ChaeumchaeProduct } from "@/lib/chaeumchae";
import { reservationHeldByItem } from "@/lib/reservation-stock";
import { normalizeWindowKey, prevWindowKey, windowKeyAt } from "@/lib/schedule";
import { orderRangeForShipment, shipmentDayOf } from "@/lib/date";

/** 발주창 K 의 createdAt 범위 — 평일은 그날 하루, 토요일 창은 토·일 이틀(출고일 기준 범위와 같음). */
export function windowCreatedRange(windowKey: string): { start: Date; end: Date } {
  return orderRangeForShipment(shipmentDayOf(normalizeWindowKey(windowKey)));
}

/**
 * 이 지점의 '발주창 K' 발주를 찾는 조건(취소 제외). windowKey 가 저장된 발주는 그 값으로,
 * 이 칸이 생기기 전 레거시 발주(windowKey=null)는 createdAt 범위로 찾는다.
 * 하루 수정 화면·하루 수정 저장·중복 종류 검사가 모두 이것을 써야 주말 토·일이 한 창으로 묶인다.
 */
export function windowOrdersWhere(userId: string, windowKey: string): Prisma.OrderWhereInput {
  const k = normalizeWindowKey(windowKey);
  const { start, end } = windowCreatedRange(k);
  return {
    userId,
    status: { not: "CANCELLED" },
    OR: [{ windowKey: k }, { windowKey: null, createdAt: { gte: start, lt: end } }],
  };
}

export type PlanCat = "FRUIT" | "VEG" | "TOOL";
export const PLAN_CATS: PlanCat[] = ["FRUIT", "VEG", "TOOL"];
export type PlanCategory = PlanCat | "TOFU";
export const PLAN_CATEGORIES: PlanCategory[] = ["FRUIT", "VEG", "TOOL", "TOFU"];

export function isPlanCat(c: string): c is PlanCat {
  return c === "FRUIT" || c === "VEG" || c === "TOOL";
}

type Db = typeof prisma | Prisma.TransactionClient;

export type PlanItemRow = {
  id: string;
  category: PlanCat;
  name: string;
  description: string;
  stockQty: number | null;
  maxPerStore: number | null;
  minPerStore: number | null;
  inventoryItemId: string;
  supplyPrice: number;
  tax: string;
  sortOrder: number;
  hidden: boolean;
};

export type DayPlan = {
  date: string;
  cats: Record<PlanCat, { exists: boolean; updatedAt: Date | null; items: PlanItemRow[] }>;
  tofu: { exists: boolean; updatedAt: Date | null; hiddenSeqs: string[] };
};

const ITEM_SELECT = {
  id: true,
  category: true,
  name: true,
  description: true,
  stockQty: true,
  maxPerStore: true,
  minPerStore: true,
  inventoryItemId: true,
  supplyPrice: true,
  tax: true,
  sortOrder: true,
  hidden: true,
} as const;

/**
 * 발주 줄 수량 문자열 → 정수(편성 줄은 서버가 정수로 저장. 관리자 수기 '3박스' 등은 숫자만).
 * 규칙은 qtyNum·displayQty 와 같다 — 콤마 빼고 '첫 숫자'만, 소수는 버림('1.5'를 15로 세지 않게).
 */
export function parsePlanQty(s: string | number | null | undefined): number {
  if (typeof s === "number") return Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  const m = String(s ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  const n = m ? Math.floor(parseFloat(m[0])) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** 그날(발주창 키) 편성 전체. 품목은 순서대로(숨김 포함). */
export async function getDayPlan(date: string, db: Db = prisma): Promise<DayPlan> {
  const plans = await db.orderPlan.findMany({
    where: { date },
    select: {
      category: true,
      hiddenSeqs: true,
      updatedAt: true,
      items: { select: ITEM_SELECT, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
  const empty = () => ({ exists: false, updatedAt: null as Date | null, items: [] as PlanItemRow[] });
  const out: DayPlan = {
    date,
    cats: { FRUIT: empty(), VEG: empty(), TOOL: empty() },
    tofu: { exists: false, updatedAt: null, hiddenSeqs: [] },
  };
  for (const p of plans) {
    if (p.category === "TOFU") {
      out.tofu = { exists: true, updatedAt: p.updatedAt, hiddenSeqs: p.hiddenSeqs ?? [] };
    } else if (isPlanCat(p.category)) {
      out.cats[p.category] = {
        exists: true,
        updatedAt: p.updatedAt,
        items: p.items.map((i) => ({ ...i, category: p.category as PlanCat })),
      };
    }
  }
  return out;
}

/** 채움채 — 그날 점주에게 보일 카탈로그(숨긴 seq 제외). 편성이 없으면 4개 전부. 순서·이름은 카탈로그 그대로. */
export function visibleTofuCatalog(hiddenSeqs: string[] | null | undefined): ChaeumchaeProduct[] {
  const hidden = new Set(hiddenSeqs ?? []);
  return CHAEUMCHAE_CATALOG.filter((p) => !hidden.has(p.seq));
}

type UsageRow = { planItemId: string; qty: string; orderId: string; userId: string };

async function usageRows(db: Db, planItemIds: string[]): Promise<UsageRow[]> {
  if (planItemIds.length === 0) return [];
  const rows = await db.orderItem.findMany({
    where: { planItemId: { in: planItemIds }, order: { status: { not: "CANCELLED" } } },
    select: { planItemId: true, qty: true, orderId: true, order: { select: { userId: true } } },
  });
  return rows.map((r) => ({ planItemId: r.planItemId, qty: r.qty, orderId: r.orderId, userId: r.order.userId }));
}

export type PlanUsage = { total: number; byStore: Map<string, number> };

/** 편성 품목 줄별 사용량(전 지점 합계 + 지점별). */
export async function planUsage(planItemIds: string[], db: Db = prisma): Promise<Map<string, PlanUsage>> {
  const m = new Map<string, PlanUsage>();
  for (const id of planItemIds) m.set(id, { total: 0, byStore: new Map() });
  for (const r of await usageRows(db, planItemIds)) {
    const u = m.get(r.planItemId);
    if (!u) continue;
    const q = parsePlanQty(r.qty);
    u.total += q;
    u.byStore.set(r.userId, (u.byStore.get(r.userId) ?? 0) + q);
  }
  return m;
}

type LinkedStock = {
  base: number;
  held: number;
  heldByStore: Map<string, number>;
  cartByStore: Map<string, number>; // 그중 재고현황 담기(CART) 몫 — 모드 전 담기와 편성이 같은 재고에 겹치는지 판정용
  resvHeld: number;
  exists: boolean;
  name: string;
};

async function linkedStock(db: Db, inventoryItemIds: string[], windowKey: string): Promise<Map<string, LinkedStock>> {
  const ids = [...new Set(inventoryItemIds.filter(Boolean))];
  const m = new Map<string, LinkedStock>();
  if (ids.length === 0) return m;
  const [inv, holds, resv] = await Promise.all([
    db.inventoryItem.findMany({ where: { id: { in: ids } }, select: { id: true, qty: true, name: true, deletedAt: true } }),
    db.stockHold.findMany({
      where: { itemId: { in: ids }, windowDate: windowKey },
      select: { itemId: true, userId: true, qty: true, source: true },
    }),
    reservationHeldByItem(db),
  ]);
  for (const id of ids)
    m.set(id, { base: 0, held: 0, heldByStore: new Map(), cartByStore: new Map(), resvHeld: resv[id] ?? 0, exists: false, name: "" });
  for (const i of inv) {
    const s = m.get(i.id)!;
    s.base = i.qty;
    s.exists = !i.deletedAt;
    s.name = i.name;
  }
  for (const h of holds) {
    const s = m.get(h.itemId);
    if (!s) continue;
    s.held += h.qty;
    s.heldByStore.set(h.userId, (s.heldByStore.get(h.userId) ?? 0) + h.qty);
    if (h.source !== "PLAN") s.cartByStore.set(h.userId, (s.cartByStore.get(h.userId) ?? 0) + h.qty);
  }
  return m;
}

function minNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

/** 전 지점 기준 남은 수량(null=무제한). 연동 공구는 실재고와 작은 쪽. */
function globalRemaining(item: PlanItemRow, usage: PlanUsage | undefined, ls: LinkedStock | undefined): number | null {
  const total = usage?.total ?? 0;
  const byPlan = item.stockQty === null ? null : item.stockQty - total;
  const byStock = item.inventoryItemId ? (ls && ls.exists ? ls.base - ls.held - ls.resvHeld : 0) : null;
  const r = minNullable(byPlan, byStock);
  return r === null ? null : Math.max(0, r);
}

export type MerchantPlanItem = PlanItemRow & {
  linked: boolean;
  mine: number; // 이 지점이 이번 창에 이미 넣은 수량
  remaining: number | null; // 전 지점 기준 남은 수량(null=무제한)
  maxForMe: number | null; // 이 지점이 둘 수 있는 최대(내 수량 포함, null=무제한)
};

export type MerchantPlanView = {
  windowKey: string;
  cats: Record<PlanCat, { exists: boolean; items: MerchantPlanItem[] }>;
  tofu: { exists: boolean; hiddenSeqs: string[]; visible: ChaeumchaeProduct[] };
};

/**
 * 점주 화면용 편성(이 지점 기준 남은 수량·최대). 숨긴 품목은 이 지점이 이미 넣은 경우에만 포함(수정 화면 '줄이기만').
 * 발주 화면·실시간 조회 API 가 같이 쓴다.
 */
export async function merchantPlanView(windowKey: string, userId: string): Promise<MerchantPlanView> {
  const plan = await getDayPlan(windowKey);
  const all = PLAN_CATS.flatMap((c) => plan.cats[c].items);
  const [usage, ls] = await Promise.all([
    planUsage(all.map((i) => i.id)),
    linkedStock(prisma, all.map((i) => i.inventoryItemId), windowKey),
  ]);
  const cats = {} as MerchantPlanView["cats"];
  for (const c of PLAN_CATS) {
    const items: MerchantPlanItem[] = [];
    for (const it of plan.cats[c].items) {
      const u = usage.get(it.id);
      const mine = u?.byStore.get(userId) ?? 0;
      if (it.hidden && mine <= 0) continue;
      const remaining = globalRemaining(it, u, it.inventoryItemId ? ls.get(it.inventoryItemId) : undefined);
      const capByRemaining = remaining === null ? null : mine + remaining;
      items.push({
        ...it,
        linked: !!it.inventoryItemId,
        mine,
        remaining,
        maxForMe: minNullable(capByRemaining, it.maxPerStore),
      });
    }
    cats[c] = { exists: plan.cats[c].exists, items };
  }
  return {
    windowKey,
    cats,
    tofu: { exists: plan.tofu.exists, hiddenSeqs: plan.tofu.hiddenSeqs, visible: visibleTofuCatalog(plan.tofu.hiddenSeqs) },
  };
}

// ── 저장 검사 ───────────────────────────────────────────────

export type PlanLineInput = { planItemId: string; qty: number };
export type PlanIssue = { planItemId: string; name: string; message: string; maxAllowed?: number | null };
export type ResolvedPlanLine = {
  planItemId: string;
  category: PlanCat;
  name: string; // 연동 공구는 그 순간의 재고 이름(계산서 이름 차감과 일치)
  qty: number;
  inventoryItemId: string;
  sortOrder: number;
};

/** 같은 지점의 동시 제출(두 번 누르기·두 기기)을 한 줄로 세운다. 같은 트랜잭션 안에서 여러 번 불러도 안전. */
export async function lockStore(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"orderplan:" + userId}))`;
}

/**
 * 편성 줄 저장 검사(트랜잭션 안에서만).
 *  lines          : 저장 후 이 지점의 그 품목 '최종' 수량(0 이면 그 줄 없음)
 *  replaceOrderIds: 이번 저장으로 편성 줄이 통째로 바뀌는 이 지점의 발주들(생성은 빈 배열)
 *  asAdmin        : 관리자 대리 수정 — 상한을 넘어도 허용하고 warnings 로만 돌려준다
 */
export async function lockAndCheckPlanLines(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    windowKey: string;
    lines: PlanLineInput[];
    replaceOrderIds?: string[];
    asAdmin?: boolean;
  },
): Promise<
  | { ok: true; resolved: ResolvedPlanLine[]; warnings: PlanIssue[] }
  | { ok: false; issues: PlanIssue[] }
> {
  const { userId, windowKey, asAdmin = false } = args;
  const replace = new Set(args.replaceOrderIds ?? []);

  // 같은 품목이 두 번 오면 합친다(화면 버그 방어). 수량은 0 이상 정수.
  const want = new Map<string, number>();
  for (const l of args.lines) {
    const id = String(l.planItemId ?? "");
    if (!id) continue;
    const q = Math.max(0, Math.floor(Number(l.qty) || 0));
    want.set(id, (want.get(id) ?? 0) + q);
  }

  await lockStore(tx, userId);

  // 이 지점이 바꾸려는 발주 안에 이미 있던 편성 줄(줄이기·지우기 판정용)
  const replacedRows = replace.size
    ? await tx.orderItem.findMany({
        where: { orderId: { in: [...replace] }, planItemId: { not: "" } },
        select: { planItemId: true },
      })
    : [];
  const ids = [...new Set([...want.keys(), ...replacedRows.map((r) => r.planItemId)])].sort();
  if (ids.length === 0) return { ok: true, resolved: [], warnings: [] };

  // 편성 품목 줄 잠금(id 순 — 모든 경로가 같은 순서라 교착 없음)
  await tx.$executeRaw`SELECT id FROM "OrderPlanItem" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
  const items = await tx.orderPlanItem.findMany({ where: { id: { in: ids } }, select: { ...ITEM_SELECT, date: true } });
  const byId = new Map(items.map((i) => [i.id, i]));

  const linkedIds = [...new Set(items.map((i) => i.inventoryItemId).filter(Boolean))].sort();
  if (linkedIds.length > 0) {
    await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id IN (${Prisma.join(linkedIds)}) ORDER BY id FOR UPDATE`;
  }

  const rows = await usageRows(tx, ids);
  const ls = await linkedStock(tx, linkedIds, windowKey);

  const issues: PlanIssue[] = [];
  const warnings: PlanIssue[] = [];
  const resolved: ResolvedPlanLine[] = [];

  for (const id of ids) {
    const it = byId.get(id);
    const newQty = want.get(id) ?? 0;
    let mineIn = 0;
    let mineOut = 0;
    let others = 0;
    for (const r of rows) {
      if (r.planItemId !== id) continue;
      const q = parsePlanQty(r.qty);
      if (r.userId !== userId) others += q;
      else if (replace.has(r.orderId)) mineIn += q;
      else mineOut += q;
    }

    if (!it || it.date !== windowKey || !isPlanCat(it.category)) {
      // 편성에서 사라졌거나 다른 날 품목. 수량 그대로/줄이기는 이름 보존 차원에서 허용하지 않는다(새로고침 안내).
      if (newQty > 0) issues.push({ planItemId: id, name: it?.name ?? "", message: "편성이 바뀌었어요. 새로고침 후 다시 넣어 주세요." });
      continue;
    }
    if (newQty === 0) continue; // 그 줄을 비움 — 항상 허용

    const name = it.inventoryItemId && ls.get(it.inventoryItemId)?.exists ? ls.get(it.inventoryItemId)!.name : it.name;
    const line: ResolvedPlanLine = {
      planItemId: id,
      category: it.category as PlanCat,
      name,
      qty: newQty,
      inventoryItemId: it.inventoryItemId,
      sortOrder: it.sortOrder,
    };

    const oldStore = mineIn + mineOut;
    const newStore = newQty + mineOut;
    const changed = newQty !== mineIn;
    const increase = newStore > oldStore;
    const problems: PlanIssue[] = [];

    if (changed && it.minPerStore && newStore < it.minPerStore) {
      problems.push({ planItemId: id, name: it.name, message: `${it.minPerStore}개부터 발주할 수 있어요.` });
    }
    if (increase) {
      if (it.hidden) {
        problems.push({ planItemId: id, name: it.name, message: "판매가 끝난 품목이에요. 수량을 늘릴 수 없어요.", maxAllowed: oldStore });
      }
      // maxAllowed = 이 줄에 둘 수 있는 최대 수량(화면이 입력칸을 그 값으로 맞출 수 있게)
      if (it.maxPerStore !== null && newStore > it.maxPerStore) {
        const lineMax = Math.max(0, it.maxPerStore - mineOut);
        problems.push({ planItemId: id, name: it.name, message: `지점당 최대 ${it.maxPerStore}개까지예요.`, maxAllowed: lineMax });
      }
      if (it.stockQty !== null && others + newStore > it.stockQty) {
        const lineMax = Math.max(0, it.stockQty - others - mineOut);
        problems.push({
          planItemId: id,
          name: it.name,
          message: lineMax > 0 ? `지금은 최대 ${lineMax}개까지 넣을 수 있어요.` : "품절됐어요.",
          maxAllowed: lineMax,
        });
      }
      if (it.inventoryItemId && (ls.get(it.inventoryItemId)?.cartByStore.get(userId) ?? 0) > 0) {
        // 모드 전에 재고현황으로 담아 이미 발주한 재고 — 원장 한 칸(지점·재고·창)을 두 방식이 나눠 쓸 수 없어
        // 편성으로 더 넣으면 원장이 틀어진다(실재고 초과). 관리자 대리 수정도 막는다(경고로 넘기지 않음).
        issues.push({
          planItemId: id,
          name: it.name,
          message: "모드 전에 재고현황으로 담은 품목이라 오늘은 편성으로 더 넣을 수 없어요.",
          maxAllowed: oldStore,
        });
        continue;
      }
      if (it.inventoryItemId) {
        const s = ls.get(it.inventoryItemId);
        const myHeld = s?.heldByStore.get(userId) ?? 0;
        const cap = s && s.exists ? s.base - (s.held - myHeld) - s.resvHeld : 0;
        if (newStore > cap) {
          const lineMax = Math.max(0, cap - mineOut);
          problems.push({
            planItemId: id,
            name: it.name,
            message: lineMax > 0 ? `재고가 모자라요. 지금은 최대 ${lineMax}개까지예요.` : "재고가 없어요.",
            maxAllowed: lineMax,
          });
        }
      }
    }

    if (problems.length > 0) {
      if (asAdmin) {
        warnings.push(...problems);
        resolved.push(line);
      } else {
        issues.push(problems[0]);
      }
      continue;
    }
    resolved.push(line);
  }

  if (issues.length > 0) return { ok: false, issues };
  resolved.sort((a, b) => a.sortOrder - b.sortOrder);
  return { ok: true, resolved, warnings };
}

/**
 * 이 지점의 이번 창 '연동 공구 발주분'을 담기원장(StockHold source=PLAN)으로 다시 맞춘다(멱등, 트랜잭션 안).
 * 재고현황·담기 현황·예약 가용이 같은 숫자를 보게 하려는 것. 지난 창은 크론이 정리하므로 현재 창만.
 *  · PLAN 행만 만들고 지운다 — 모드 전에 재고현황으로 담은 CART 행은 절대 덮어쓰지 않는다
 *    (같은 재고를 편성으로 더 넣는 건 lockAndCheckPlanLines 가 막는다).
 *  · 그 출고일 계산서가 이미 재고를 차감했으면 원장을 비운다(예약 홀드와 같은 규칙 — 이중집계 방지).
 */
export async function syncPlanHolds(
  tx: Prisma.TransactionClient,
  userId: string,
  windowKey: string,
  now: number = Date.now(),
): Promise<void> {
  if (windowKey !== windowKeyAt(now)) return;
  const deducted = await tx.invoice.findFirst({
    where: { userId, kind: "DAILY", date: shipmentDayOf(windowKey), stockDeductedAt: { not: null } },
    select: { id: true },
  });
  if (deducted) {
    await tx.stockHold.deleteMany({ where: { userId, windowDate: windowKey, source: "PLAN" } });
    return;
  }
  const rows = await tx.orderItem.findMany({
    where: {
      planItemId: { not: "" },
      inventoryItemId: { not: "" },
      order: { userId, windowKey, category: "TOOL", status: { not: "CANCELLED" } },
    },
    select: { inventoryItemId: true, name: true, qty: true },
  });
  const want = new Map<string, { qty: number; name: string }>();
  for (const r of rows) {
    const cur = want.get(r.inventoryItemId) ?? { qty: 0, name: r.name };
    cur.qty += parsePlanQty(r.qty);
    want.set(r.inventoryItemId, cur);
  }
  const existing = await tx.stockHold.findMany({
    where: { userId, windowDate: windowKey },
    select: { itemId: true, source: true },
  });
  const cartItems = new Set(existing.filter((e) => e.source !== "PLAN").map((e) => e.itemId));
  const stale = existing
    .filter((e) => e.source === "PLAN")
    .map((e) => e.itemId)
    .filter((id) => !want.has(id) || (want.get(id)?.qty ?? 0) <= 0);
  if (stale.length > 0) {
    await tx.stockHold.deleteMany({ where: { userId, windowDate: windowKey, source: "PLAN", itemId: { in: stale } } });
  }
  for (const [itemId, v] of want) {
    if (v.qty <= 0 || cartItems.has(itemId)) continue; // CART 행은 그대로(덮어쓰면 옛 담기 발주분이 원장에서 빠진다)
    await tx.stockHold.upsert({
      where: { userId_itemId_windowDate: { userId, itemId, windowDate: windowKey } },
      create: { userId, itemId, name: v.name, qty: v.qty, windowDate: windowKey, source: "PLAN" },
      update: { qty: v.qty, name: v.name },
    });
  }
}

/**
 * 제한 모드 지점의 '아직 발주에 안 쓴' 재고현황 담기(CART)를 푼다(트랜잭션 안, 지점 잠금 뒤).
 * 제한 모드 화면은 담기를 쓰지 않아서, 모드 전에 담아 둔 것이 창 끝까지 다른 지점 몫을 깎는 걸 막는다.
 * 이미 발주 줄이 가리키는 담기(재고 id, 옛 줄은 이름)는 그 발주의 원장이라 그대로 둔다.
 */
export async function releaseOrphanCartHolds(
  tx: Prisma.TransactionClient,
  userId: string,
  windowKey: string,
): Promise<void> {
  const carts = await tx.stockHold.findMany({
    where: { userId, windowDate: windowKey, source: { not: "PLAN" } },
    select: { id: true, itemId: true, name: true },
  });
  if (carts.length === 0) return;
  const lines = await tx.orderItem.findMany({
    where: { order: { ...windowOrdersWhere(userId, windowKey), category: "TOOL" } },
    select: { inventoryItemId: true, name: true },
  });
  const usedIds = new Set(lines.map((l) => l.inventoryItemId).filter(Boolean));
  const usedNames = new Set(lines.filter((l) => !l.inventoryItemId).map((l) => l.name.trim()));
  const orphan = carts.filter((c) => !usedIds.has(c.itemId) && !usedNames.has(c.name.trim())).map((c) => c.id);
  if (orphan.length > 0) await tx.stockHold.deleteMany({ where: { id: { in: orphan } } });
}

// ── 관리자용 ────────────────────────────────────────────────

export type AdminPlanStat = {
  total: number;
  storeCount: number;
  byStore: { userId: string; storeName: string; qty: number }[];
  remaining: number | null;
  linked: null | { base: number; held: number; resvHeld: number; real: number; exists: boolean; name: string };
};

/** 관리자 편집 화면 '발주 12 / 재고 30 · 4곳' 과 지점별 내역. */
export async function planStatsForDate(date: string): Promise<Map<string, AdminPlanStat>> {
  const plan = await getDayPlan(date);
  const all = PLAN_CATS.flatMap((c) => plan.cats[c].items);
  const [usage, ls] = await Promise.all([
    planUsage(all.map((i) => i.id)),
    linkedStock(prisma, all.map((i) => i.inventoryItemId), date),
  ]);
  const userIds = [...new Set([...usage.values()].flatMap((u) => [...u.byStore.keys()]))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, storeName: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.storeName]));
  const out = new Map<string, AdminPlanStat>();
  for (const it of all) {
    const u = usage.get(it.id);
    const s = it.inventoryItemId ? ls.get(it.inventoryItemId) : undefined;
    out.set(it.id, {
      total: u?.total ?? 0,
      storeCount: u ? [...u.byStore.values()].filter((q) => q > 0).length : 0,
      byStore: u
        ? [...u.byStore.entries()]
            .filter(([, q]) => q > 0)
            .map(([userId, qty]) => ({ userId, storeName: nameOf.get(userId) ?? "", qty }))
            .sort((a, b) => b.qty - a.qty)
        : [],
      remaining: globalRemaining(it, u, s),
      linked: s
        ? { base: s.base, held: s.held, resvHeld: s.resvHeld, real: Math.max(0, s.base - s.held - s.resvHeld), exists: s.exists, name: s.name }
        : null,
    });
  }
  return out;
}

/** '전날 불러오기' 출처 — 직전 발주창에 편성이 있으면 그 날, 없으면 그 전의 가장 최근 편성일. 없으면 null. */
export async function prevPlannedDate(date: string, category: PlanCategory): Promise<string | null> {
  const prev = prevWindowKey(date);
  const hit = await prisma.orderPlan.findUnique({
    where: { date_category: { date: prev, category } },
    select: { date: true },
  });
  if (hit) return hit.date;
  const latest = await prisma.orderPlan.findFirst({
    where: { category, date: { lt: date } },
    orderBy: { date: "desc" },
    select: { date: true },
  });
  return latest?.date ?? null;
}
