// 품목 제한 모드 — 관리자 편성 화면 서버 조회 헬퍼(서버 전용).
// 계산은 order-plan.ts(공용 뼈대)의 함수를 그대로 쓰고, 여기서는 화면 모양으로만 바꾼다.

import { prisma } from "@/lib/prisma";
import { heldByItem } from "@/lib/stock-hold";
import { lockedInventoryItemIds, reservationHeldByItem } from "@/lib/reservation-stock";
import { CHAEUMCHAE_CATALOG, seqForName } from "@/lib/chaeumchae";
import { planStatsForDate, parsePlanQty, windowCreatedRange } from "@/lib/order-plan";
import { normFixedName } from "@/lib/order-flags";
import { nextWindowKey, windowKeyAt } from "@/lib/schedule";
import type { CatState, InvPick, ItemCat, ItemStat, LoadedDraft, ModeCardInfo, PreflightWindow } from "./types";
import { ITEM_CATS } from "./types";
import { labelDate } from "@/lib/date";

/** 편성 품목명 비교용 정규화(공백 접기·트림). */
export const normPlanName = normFixedName;

/** 공구 연동 고르기 목록 — 실재고(기준재고 − 그 창 담기 − 예약 홀드)와 예약 진행 중 여부. */
export async function inventoryPickList(windowKey: string): Promise<InvPick[]> {
  const [inv, held, resv, locked] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true, supplyPrice: true, tax: true, qty: true },
    }),
    heldByItem(windowKey),
    reservationHeldByItem(),
    lockedInventoryItemIds(),
  ]);
  return inv.map((i) => ({
    id: i.id,
    name: i.name,
    supplyPrice: i.supplyPrice,
    tax: i.tax,
    base: i.qty,
    real: Math.max(0, i.qty - (held[i.id] ?? 0) - (resv[i.id] ?? 0)),
    locked: locked.has(i.id),
  }));
}

type InvLite = { id: string; name: string; supplyPrice: number; tax: string; deletedAt: Date | null };

/** 연동 공구 초안 다시 잇기 — 살아 있으면 그대로(이름·공급가·과세는 재고 값), 끊겼으면 같은 이름 재고로, 없으면 수기 + '연동 끊김'. */
export async function relinkDrafts(drafts: LoadedDraft[]): Promise<{ items: LoadedDraft[]; notes: string[] }> {
  const ids = [...new Set(drafts.map((d) => d.inventoryItemId).filter(Boolean))];
  const names = [...new Set(drafts.filter((d) => d.inventoryItemId).map((d) => d.name))];
  if (ids.length === 0) return { items: drafts, notes: [] };
  const [byIdRows, byNameRows] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, supplyPrice: true, tax: true, deletedAt: true },
    }),
    prisma.inventoryItem.findMany({
      where: { name: { in: names }, deletedAt: null },
      orderBy: { updatedAt: "desc" },
      select: { id: true, name: true, supplyPrice: true, tax: true, deletedAt: true },
    }),
  ]);
  const byId = new Map<string, InvLite>(byIdRows.map((r) => [r.id, r]));
  const byName = new Map<string, InvLite>();
  for (const r of byNameRows) if (!byName.has(normPlanName(r.name))) byName.set(normPlanName(r.name), r);
  const notes: string[] = [];
  const items = drafts.map((d) => {
    if (!d.inventoryItemId) return d;
    const hit = byId.get(d.inventoryItemId);
    if (hit && !hit.deletedAt) {
      return { ...d, name: hit.name, supplyPrice: hit.supplyPrice, tax: hit.tax };
    }
    const same = byName.get(normPlanName(d.name));
    if (same) {
      notes.push(`'${d.name}' 재고가 바뀌어 같은 이름 재고로 다시 연동했어요.`);
      return { ...d, inventoryItemId: same.id, name: same.name, supplyPrice: same.supplyPrice, tax: same.tax };
    }
    notes.push(`'${d.name}' 재고를 못 찾아 수기 공구로 바꿨어요. 공급가·과세를 확인해 주세요.`);
    return { ...d, inventoryItemId: "", brokenLink: true };
  });
  return { items, notes };
}

/** 그날 종류별 편성 상태(있음/품목 수/닫힘/없음). 숨긴 품목은 세지 않는다. */
export async function windowStatuses(keys: string[]): Promise<
  Record<string, { cats: Record<ItemCat, CatState>; tofu: { exists: boolean; visible: number; total: number } }>
> {
  const uniq = [...new Set(keys)];
  const rows = uniq.length
    ? await prisma.orderPlan.findMany({
        where: { date: { in: uniq } },
        select: {
          date: true,
          category: true,
          hiddenSeqs: true,
          _count: { select: { items: { where: { hidden: false } } } },
        },
      })
    : [];
  const total = CHAEUMCHAE_CATALOG.length;
  const out: Record<string, { cats: Record<ItemCat, CatState>; tofu: { exists: boolean; visible: number; total: number } }> = {};
  for (const k of uniq) {
    out[k] = {
      cats: {
        FRUIT: { state: "none", count: 0 },
        VEG: { state: "none", count: 0 },
        TOOL: { state: "none", count: 0 },
      },
      tofu: { exists: false, visible: total, total },
    };
  }
  const catalogSeqs = new Set(CHAEUMCHAE_CATALOG.map((p) => p.seq));
  for (const r of rows) {
    const o = out[r.date];
    if (!o) continue;
    if (r.category === "TOFU") {
      const hidden = (r.hiddenSeqs ?? []).filter((s) => catalogSeqs.has(s)).length;
      o.tofu = { exists: true, visible: total - hidden, total };
    } else if (r.category === "FRUIT" || r.category === "VEG" || r.category === "TOOL") {
      const n = r._count.items;
      o.cats[r.category] = { state: n > 0 ? "some" : "closed", count: n };
    }
  }
  return out;
}

export function toPreflightWindow(
  key: string,
  st: { cats: Record<ItemCat, CatState>; tofu: { exists: boolean; visible: number; total: number } },
): PreflightWindow {
  return { key, label: labelDate(key), cats: st.cats, tofu: st.tofu };
}

/** 지금부터 n개 발주창 키(지금 창 포함). */
export function upcomingKeys(n: number, from: string = windowKeyAt()): string[] {
  const out: string[] = [];
  let k = from;
  for (let i = 0; i < n; i++) {
    out.push(k);
    k = nextWindowKey(k);
  }
  return out;
}

/** 관리자 홈 배지 — 이번·다음 창에 편성이 비어 있는(행 없음) 편성 종류(ITEM_CATS = 과일·야채) 수. */
export async function missingPlanCount(): Promise<number> {
  const cur = windowKeyAt();
  const keys = [cur, nextWindowKey(cur)];
  const rows = await prisma.orderPlan.findMany({
    where: { date: { in: keys }, category: { in: ITEM_CATS } },
    select: { date: true, category: true },
  });
  return keys.length * ITEM_CATS.length - rows.length;
}

/** 편집 화면 품목별 현황(planStatsForDate 를 화면용 모양으로). */
export async function itemStatsForDate(date: string): Promise<Record<string, ItemStat>> {
  const m = await planStatsForDate(date);
  const out: Record<string, ItemStat> = {};
  for (const [id, s] of m) {
    out[id] = {
      total: s.total,
      storeCount: s.storeCount,
      remaining: s.remaining,
      byStore: s.byStore.map((b) => ({ storeName: b.storeName || "(이름 없음)", qty: b.qty })),
      real: s.linked ? s.linked.real : null,
    };
  }
  return out;
}

/** 채움채 — 그 창에 이미 들어온 박스 수(seq 별, 취소 제외, 전 지점). */
export async function tofuBoxesForWindow(windowKey: string): Promise<Record<string, number>> {
  const { start, end } = windowCreatedRange(windowKey);
  const rows = await prisma.orderItem.findMany({
    where: {
      order: {
        category: "TOFU",
        status: { not: "CANCELLED" },
        OR: [{ windowKey }, { windowKey: null, createdAt: { gte: start, lt: end } }],
      },
    },
    select: { name: true, rawName: true, qty: true, rawQty: true },
  });
  const out: Record<string, number> = {};
  for (const r of rows) {
    const seq = seqForName(r.name || r.rawName);
    if (!seq) continue;
    out[seq] = (out[seq] ?? 0) + parsePlanQty(r.qty || r.rawQty);
  }
  return out;
}

/** 품목 제한 모드 카드 표시용 요약. */
export function modeCardInfo(cfg: { on: boolean; from: string; pilot: string[] }): ModeCardInfo {
  const now = windowKeyAt();
  return {
    on: cfg.on,
    from: cfg.from,
    fromLabel: cfg.from ? labelDate(cfg.from) : "",
    pilotCount: cfg.pilot.length,
    active: cfg.on && (!cfg.from || now >= cfg.from),
  };
}
