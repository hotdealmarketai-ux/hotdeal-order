"use server";

// ============================================================
//  품목 제한 모드 — 관리자 편성 저장·불러오기·복사·스위치
//  · 편성 날짜 = 발주창 키(windowKeyAt). 지난 창은 읽기 전용.
//  · 저장은 날짜 하나를 한 트랜잭션으로(보낸 종류만). 다른 관리자가 먼저 저장했으면 거절(updatedAt 비교).
//  · 발주가 들어간 품목 줄은 지우지 않고 숨긴다(발주 참조 보존). 계산은 order-plan.ts 그대로.
// ============================================================

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import { logError } from "@/lib/log";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import {
  getDayPlan,
  planUsage,
  prevPlannedDate,
  windowCreatedRange,
  type PlanCategory,
} from "@/lib/order-plan";
import { readRestrictConfig, setRestrictConfig } from "@/lib/restrict-mode";
import { isWindowKey, nextWindowKey, normalizeWindowKey, upcomingWindowKey, windowKeyAt } from "@/lib/schedule";
import { labelDate } from "@/lib/date";
import { normalizeTax } from "@/lib/tax";
import { lockedInventoryItemIds, minLockedPickupDate } from "@/lib/reservation-stock";
import {
  normPlanName,
  relinkDrafts,
  toPreflightWindow,
  windowStatuses,
} from "@/app/(admin)/admin/order-plan/_lib/plan-data";
import {
  ALL_CATS,
  CAT_LABEL,
  ITEM_CATS,
  type AnyCat,
  type CopyPlanInput,
  type CopyPlanResult,
  type ItemCat,
  type ItemDraft,
  type LoadedDraft,
  type LoadPrevResult,
  type PreflightResult,
  type SaveDayPlanInput,
  type SaveDayPlanResult,
} from "@/app/(admin)/admin/order-plan/_lib/types";

const MAX_ITEMS = 200;
const MAX_QTY = 1_000_000;
const NAME_MAX = 60;
const DESC_MAX = 200;
const CONFLICT = "다른 관리자가 먼저 저장했어요. 새로고침 후 다시 저장해 주세요.";

/** 화면에 그대로 보여 줄 오류(트랜잭션을 되돌리려고 던진다). */
class PlanError extends Error {
  constructor(
    message: string,
    public cat?: AnyCat,
    public index?: number,
  ) {
    super(message);
  }
}

function isItemCat(c: unknown): c is ItemCat {
  return c === "FRUIT" || c === "VEG" || c === "TOOL";
}
function isAnyCat(c: unknown): c is AnyCat {
  return isItemCat(c) || c === "TOFU";
}

/** 0 이상 정수 또는 null. 그 밖의 값은 오류 문구. */
function intOrNull(v: unknown, label: string): number | null | string {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,\s]/g, ""));
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) return `${label}은(는) 0 이상 정수로 넣어 주세요.`;
  if (n > MAX_QTY) return `${label}이(가) 너무 커요.`;
  return n;
}

function revalidatePlan(dates: string[]) {
  revalidatePath("/admin/order-plan");
  for (const d of new Set(dates)) {
    revalidatePath("/admin/order-plan/" + d);
    revalidatePath("/admin/order-plan/" + d + "/preview");
  }
  revalidatePath("/order");
}

type CleanItem = {
  id: string; // ""=새 줄
  name: string;
  description: string;
  stockQty: number | null;
  maxPerStore: number | null;
  minPerStore: number | null;
  inventoryItemId: string;
  supplyPrice: number;
  tax: string;
  hidden: boolean;
};

/** 초안 검사·정리(DB 없이 할 수 있는 것). 이름 중복·숫자·최소≤최대≤재고. */
function cleanDrafts(cat: ItemCat, raw: unknown): CleanItem[] {
  if (!Array.isArray(raw)) throw new PlanError("잘못된 요청이에요.", cat);
  if (raw.length > MAX_ITEMS) throw new PlanError(`${CAT_LABEL[cat]} 품목은 ${MAX_ITEMS}개까지 넣을 수 있어요.`, cat);
  const seen = new Map<string, number>();
  const out: CleanItem[] = [];
  raw.forEach((r: Partial<ItemDraft>, i) => {
    const name = normPlanName(String(r?.name ?? "")).slice(0, NAME_MAX);
    const linked = cat === "TOOL" ? String(r?.inventoryItemId ?? "").trim() : "";
    if (!name && !linked) throw new PlanError(`${CAT_LABEL[cat]} ${i + 1}번째 줄에 품목명을 넣어 주세요.`, cat, i);
    const stockQty = intOrNull(r?.stockQty, "재고수량");
    const maxPerStore = intOrNull(r?.maxPerStore, "지점당 최대");
    const minPerStore = cat === "TOOL" ? intOrNull(r?.minPerStore, "최소 수량") : null;
    for (const v of [stockQty, maxPerStore, minPerStore]) {
      if (typeof v === "string") throw new PlanError(`'${name || i + 1 + "번째 줄"}' ${v}`, cat, i);
    }
    const sq = stockQty as number | null;
    const mx = maxPerStore as number | null;
    const mn = minPerStore as number | null;
    if (mn !== null && mn > 0 && mx !== null && mn > mx) {
      throw new PlanError(`'${name}' 최소 수량(${mn})이 지점당 최대(${mx})보다 커요. 최소를 줄이거나 최대를 늘려 주세요.`, cat, i);
    }
    if (mn !== null && mn > 0 && sq !== null && mn > sq) {
      throw new PlanError(`'${name}' 최소 수량(${mn})이 재고수량(${sq})보다 커요. 이대로면 아무도 발주할 수 없어요.`, cat, i);
    }
    if (name) {
      const prev = seen.get(name);
      if (prev !== undefined) {
        throw new PlanError(`${CAT_LABEL[cat]}에 '${name}'이(가) 두 번 있어요(${prev + 1}번째·${i + 1}번째). 하나로 합치거나 이름을 나눠 주세요(예: 양파(소)·양파(대)).`, cat, i);
      }
      seen.set(name, i);
    }
    const price = intOrNull(r?.supplyPrice, "공급가");
    if (typeof price === "string") throw new PlanError(`'${name}' ${price}`, cat, i);
    out.push({
      id: typeof r?.id === "string" ? r.id : "",
      name,
      description: String(r?.description ?? "").trim().slice(0, DESC_MAX),
      stockQty: sq,
      maxPerStore: mx,
      minPerStore: mn && mn > 0 ? mn : null,
      inventoryItemId: linked,
      supplyPrice: cat === "TOOL" ? (price ?? 0) : 0,
      tax: cat === "TOOL" ? normalizeTax(r?.tax) : "",
      hidden: r?.hidden === true,
    });
  });
  return out;
}

function cleanTofu(raw: unknown): string[] {
  const list = Array.isArray((raw as { hiddenSeqs?: unknown })?.hiddenSeqs)
    ? ((raw as { hiddenSeqs: unknown[] }).hiddenSeqs as unknown[])
    : null;
  if (!list) throw new PlanError("잘못된 요청이에요.", "TOFU");
  const allowed = new Set(CHAEUMCHAE_CATALOG.map((p) => p.seq));
  const out: string[] = [];
  for (const s of list) {
    const v = String(s ?? "");
    if (!allowed.has(v)) throw new PlanError("채움채 목록에 없는 품목이에요. 새로고침 후 다시 해 주세요.", "TOFU");
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

type ExistingItem = {
  id: string;
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

async function lockPlanRow(tx: Prisma.TransactionClient, date: string, category: string) {
  await tx.$executeRaw`SELECT id FROM "OrderPlan" WHERE "date" = ${date} AND "category" = ${category} FOR UPDATE`;
  return tx.orderPlan.findUnique({
    where: { date_category: { date, category } },
    select: {
      id: true,
      updatedAt: true,
      hiddenSeqs: true,
      items: {
        orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
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
        },
      },
    },
  });
}

async function lockItemRows(tx: Prisma.TransactionClient, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  if (sorted.length === 0) return;
  await tx.$executeRaw`SELECT id FROM "OrderPlanItem" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
}

type LockedPlan = Awaited<ReturnType<typeof lockPlanRow>>;

/**
 * 편성 저장 트랜잭션 — 교착·쓰기 충돌이면 한 번만 다시(발주 저장 runOrderTx 와 같은 규칙).
 * 잠금 순서(모든 경로 공통): 종류 행(과일→야채→공구→채움채) → 품목 줄 전부를 id 순 한 문장으로.
 * 점주 발주 저장(lockAndCheckPlanLines)도 품목 줄을 id 순 한 문장으로 잡아 서로 엇갈려 잠그지 않는다.
 */
async function runPlanTx<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, { timeout: 20000, maxWait: 8000 });
    } catch (e) {
      const retryable =
        e instanceof Prisma.PrismaClientKnownRequestError &&
        (e.code === "P2034" || (e.code === "P2010" && /40P01|40001|deadlock/i.test(e.message)));
      if (attempt < 1 && retryable) continue;
      throw e;
    }
  }
}

const sameItem = (a: ExistingItem, b: CleanItem, sortOrder: number) =>
  a.name === b.name &&
  a.description === b.description &&
  a.stockQty === b.stockQty &&
  a.maxPerStore === b.maxPerStore &&
  a.minPerStore === b.minPerStore &&
  a.inventoryItemId === b.inventoryItemId &&
  a.supplyPrice === b.supplyPrice &&
  a.tax === b.tax &&
  a.hidden === b.hidden &&
  a.sortOrder === sortOrder;

// ── 1) 날짜 하나 저장 ─────────────────────────────────────────

export async function saveDayPlanAction(input: SaveDayPlanInput): Promise<SaveDayPlanResult> {
  const admin = await requireAdmin();
  const date = String(input?.date ?? "");
  if (!isWindowKey(date)) return { ok: false, error: "날짜가 올바르지 않아요. 달력에서 다시 골라 주세요." };
  if (date < windowKeyAt()) return { ok: false, error: "지난 발주창은 고칠 수 없어요(읽기 전용)." };

  const cats = input?.cats ?? {};
  const base = input?.base ?? {};
  const sent = ALL_CATS.filter((c) => cats[c] !== undefined);
  if (sent.length === 0) return { ok: true, notices: [], warnings: [], updatedAt: {} };

  // DB 없이 하는 검사 먼저
  const clean: Partial<Record<ItemCat, CleanItem[]>> = {};
  let tofuHidden: string[] | null = null;
  try {
    for (const c of ITEM_CATS) if (cats[c] !== undefined) clean[c] = cleanDrafts(c, cats[c]);
    if (cats.TOFU !== undefined) tofuHidden = cleanTofu(cats.TOFU);
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message, cat: e.cat, index: e.index };
    throw e;
  }

  // 공구 연동 재고(존재·미삭제·예약 진행 중) — 트랜잭션 밖에서 읽고 안에서 판정
  const toolInvIds = [...new Set((clean.TOOL ?? []).map((i) => i.inventoryItemId).filter(Boolean))];
  // 수기 공구 이름 검사용 재고현황 이름(미삭제) — 계산서는 이름으로 재고를 빼는데 수기 줄은 담기원장을 안 잡는다
  const hasManualTool = (clean.TOOL ?? []).some((i) => !i.inventoryItemId);
  const [invRows, lockedSet, liveInv] = await Promise.all([
    toolInvIds.length
      ? prisma.inventoryItem.findMany({
          where: { id: { in: toolInvIds } },
          select: { id: true, name: true, supplyPrice: true, tax: true, deletedAt: true },
        })
      : Promise.resolve([]),
    toolInvIds.length ? lockedInventoryItemIds() : Promise.resolve(new Set<string>()),
    hasManualTool
      ? prisma.inventoryItem.findMany({ where: { deletedAt: null }, select: { name: true } })
      : Promise.resolve([] as { name: string }[]),
  ]);
  const invById = new Map(invRows.map((r) => [r.id, r]));
  const invByName = new Map(liveInv.map((r) => [normPlanName(r.name), r.name]));

  // 교착으로 한 번 더 시도하면 처음부터 다시 적는다
  let notices: string[] = [];
  let warnings: string[] = [];
  let summary: string[] = [];
  let snapshot: Record<string, unknown> = {};
  let updatedAt: Partial<Record<AnyCat, string | null>> = {};

  try {
    await runPlanTx(async (tx) => {
      notices = [];
      warnings = [];
      summary = [];
      snapshot = {};
      updatedAt = {};

      // 종류 행을 먼저 전부 잠그고(충돌 확인), 품목 줄은 보낸 종류 것을 모아 id 순으로 한 번에 잠근다
      const curs = new Map<AnyCat, LockedPlan>();
      for (const cat of sent) {
        const cur = await lockPlanRow(tx, date, cat);
        const curIso = cur ? cur.updatedAt.toISOString() : null;
        const baseIso = base[cat] ?? null;
        if (baseIso !== curIso) throw new PlanError(CONFLICT, cat);
        curs.set(cat, cur);
      }
      await lockItemRows(tx, [...curs.values()].flatMap((c) => c?.items.map((e) => e.id) ?? []));

      for (const cat of sent) {
        const cur = curs.get(cat) ?? null;

        if (cat === "TOFU") {
          const hidden = tofuHidden ?? [];
          const before = cur?.hiddenSeqs ?? [];
          const row = cur
            ? await tx.orderPlan.update({
                where: { id: cur.id },
                data: { hiddenSeqs: hidden, updatedBy: admin.id },
                select: { updatedAt: true },
              })
            : await tx.orderPlan.create({
                data: { date, category: "TOFU", hiddenSeqs: hidden, updatedBy: admin.id },
                select: { updatedAt: true },
              });
          updatedAt.TOFU = row.updatedAt.toISOString();
          const nm = (s: string) => CHAEUMCHAE_CATALOG.find((p) => p.seq === s)?.name ?? s;
          summary.push(`채움채 숨김 ${hidden.length}개`);
          snapshot.TOFU = { before: before.map(nm), after: hidden.map(nm) };
          continue;
        }

        // 복사본으로 다룬다(아래에서 id·이름을 고쳐 쓰므로 다시 시도해도 같은 입력에서 시작)
        const items = (clean[cat] ?? []).map((it) => ({ ...it }));
        const existing: ExistingItem[] = cur?.items ?? [];
        const exById = new Map(existing.map((e) => [e.id, e]));
        // 다른 날·다른 종류 줄 id 가 섞여 오면 새 줄로 본다(복사 화면 방어)
        for (const it of items) if (it.id && !exById.has(it.id)) it.id = "";

        const usage = await planUsage(existing.map((e) => e.id), tx);
        const used = (id: string) => usage.get(id)?.total ?? 0;
        const hasOrders = (id: string) => {
          const u = usage.get(id);
          return !!u && (u.total > 0 || u.byStore.size > 0);
        };

        // 빠진 줄 중 발주가 있어 숨김으로 남는 줄 — 지운 줄과 같은 재고·이름을 새로 넣지 못하게 중복 검사에 넣는다
        const keepIds = new Set(items.map((i) => i.id).filter(Boolean));
        const gone = existing.filter((e) => !keepIds.has(e.id));
        const keptHidden = gone.filter((g) => hasOrders(g.id));
        const keptLink = new Map(keptHidden.filter((g) => g.inventoryItemId).map((g) => [g.inventoryItemId, g.name]));
        const keptName = new Set(keptHidden.map((g) => g.name));
        const keptMsg = (n: string) => `이미 발주가 들어간 숨긴 줄 ‘${n}’과 같아요. 그 줄을 다시 보이게 해 주세요.`;

        // 공구 연동 판정 — 이름은 재고 이름으로 강제, 같은 재고 두 번 금지, 예약 진행 중 금지
        if (cat === "TOOL") {
          const linkSeen = new Map<string, number>();
          items.forEach((it, i) => {
            const ex = it.id ? exById.get(it.id) : undefined;
            if (!it.inventoryItemId) {
              // 수기 공구가 재고현황 이름과 같으면 거절(계산서 이름 차감과 담기원장이 어긋남).
              // 숨긴 채 그대로인 옛 수기 줄은 더 늘릴 수 없으니 둔다.
              const same = invByName.get(it.name);
              const oldHidden = it.hidden && !!ex && !ex.inventoryItemId && ex.name === it.name;
              if (same !== undefined && !oldHidden) {
                throw new PlanError(`재고현황의 ‘${same}’과 이름이 같아요. 재고 연동으로 넣거나 이름을 바꿔 주세요.`, cat, i);
              }
              return;
            }
            const unchangedLink = !!ex && ex.inventoryItemId === it.inventoryItemId;
            const inv = invById.get(it.inventoryItemId);
            if (!inv || inv.deletedAt) {
              // 재고가 지워졌어도 숨긴 줄·발주가 들어간 줄은 연동 그대로 둔다(실재고 0 이라 점주는 더 못 늘림)
              if (!ex || !unchangedLink || !(it.hidden || hasOrders(ex.id))) {
                throw new PlanError(`'${it.name || ex?.name || i + 1 + "번째 줄"}'에 연동한 재고가 지워졌어요. 연동을 풀거나 다른 재고를 골라 주세요.`, cat, i);
              }
              it.name = ex.name;
              it.supplyPrice = ex.supplyPrice;
              it.tax = ex.tax;
            } else {
              it.name = normPlanName(inv.name).slice(0, NAME_MAX);
              it.supplyPrice = inv.supplyPrice;
              it.tax = normalizeTax(inv.tax);
            }
            if (!unchangedLink && lockedSet.has(it.inventoryItemId)) {
              throw new PlanError(`'${it.name}'은(는) 지금 예약발주가 진행 중인 재고라 공구에 연동할 수 없어요. 예약이 끝난 뒤 연동하거나 수기 공구로 넣어 주세요.`, cat, i);
            }
            const kept = keptLink.get(it.inventoryItemId);
            if (kept !== undefined) throw new PlanError(keptMsg(kept), cat, i);
            const prev = linkSeen.get(it.inventoryItemId);
            if (prev !== undefined) {
              throw new PlanError(`같은 재고 '${it.name}'을(를) 두 줄에 연동했어요(${prev + 1}번째·${i + 1}번째). 한 줄로 합쳐 주세요.`, cat, i);
            }
            linkSeen.set(it.inventoryItemId, i);
          });
          // 이름 강제 뒤 이름 중복 다시 확인
          const nameSeen = new Map<string, number>();
          items.forEach((it, i) => {
            const p = nameSeen.get(it.name);
            if (p !== undefined) throw new PlanError(`공구에 '${it.name}'이(가) 두 번 있어요(${p + 1}번째·${i + 1}번째).`, cat, i);
            nameSeen.set(it.name, i);
          });
        }

        // 숨김으로 남는 빠진 줄과 이름이 같으면 거절(과일·야채·공구 공통)
        items.forEach((it, i) => {
          if (it.name && keptName.has(it.name)) throw new PlanError(keptMsg(it.name), cat, i);
        });

        // 발주가 들어간 줄의 재고 연동은 바꿀 수 없다(발주 줄·담기원장과 어긋남)
        items.forEach((it, i) => {
          const ex = it.id ? exById.get(it.id) : undefined;
          if (ex && hasOrders(ex.id) && ex.inventoryItemId !== it.inventoryItemId) {
            throw new PlanError(`'${ex.name}'은(는) 이미 발주가 들어가 있어 재고 연동을 바꿀 수 없어요. 이 줄은 숨기고 새 줄로 추가해 주세요.`, cat, i);
          }
        });

        const plan = cur
          ? { id: cur.id }
          : await tx.orderPlan.create({ data: { date, category: cat, updatedBy: admin.id }, select: { id: true } });

        let added = 0;
        let changed = 0;
        let removed = 0;
        let hiddenInstead = 0;

        // 빠진 줄: 발주가 있으면 숨김, 없으면 삭제
        let tail = items.length;
        for (const g of gone) {
          if (hasOrders(g.id)) {
            await tx.orderPlanItem.update({ where: { id: g.id }, data: { hidden: true, sortOrder: tail++ } });
            hiddenInstead++;
            if (!g.hidden) notices.push(`'${g.name}'은(는) 이미 발주가 들어가 있어 지우지 않고 숨겼어요.`);
          } else {
            await tx.orderPlanItem.delete({ where: { id: g.id } });
            removed++;
          }
        }

        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const data = {
            name: it.name,
            description: it.description,
            stockQty: it.stockQty,
            maxPerStore: it.maxPerStore,
            minPerStore: it.minPerStore,
            inventoryItemId: it.inventoryItemId,
            supplyPrice: it.supplyPrice,
            tax: it.tax,
            hidden: it.hidden,
            sortOrder: i,
          };
          const ex = it.id ? exById.get(it.id) : undefined;
          if (ex) {
            if (sameItem(ex, it, i)) continue;
            await tx.orderPlanItem.update({ where: { id: ex.id }, data });
            if (!sameItem({ ...ex, sortOrder: i }, it, i)) changed++; // 순서만 바뀐 것은 세지 않음
            const total = used(ex.id);
            if (it.stockQty !== null && total > it.stockQty && it.stockQty !== ex.stockQty) {
              warnings.push(`'${it.name}' 재고수량 ${it.stockQty}개가 이미 들어온 발주 ${total}개보다 적어요. 들어온 발주는 그대로 두고 더 받지 않아요.`);
            }
            if (it.maxPerStore !== null && it.maxPerStore !== ex.maxPerStore) {
              const over = [...(usage.get(ex.id)?.byStore.values() ?? [])].filter((q) => q > (it.maxPerStore as number)).length;
              if (over > 0) warnings.push(`'${it.name}' 지점당 최대 ${it.maxPerStore}개보다 이미 많이 넣은 지점이 ${over}곳 있어요. 그 발주는 그대로 둬요.`);
            }
          } else {
            await tx.orderPlanItem.create({ data: { ...data, planId: plan.id, date, category: cat } });
            added++;
          }
        }

        const row = await tx.orderPlan.update({
          where: { id: plan.id },
          data: { updatedBy: admin.id },
          select: { updatedAt: true },
        });
        updatedAt[cat] = row.updatedAt.toISOString();
        const parts = [`${items.filter((i) => !i.hidden).length}개`];
        if (added) parts.push(`+${added}`);
        if (removed) parts.push(`−${removed}`);
        if (changed) parts.push(`수정 ${changed}`);
        if (hiddenInstead) parts.push(`숨김 ${hiddenInstead}`);
        summary.push(`${CAT_LABEL[cat]} ${parts.join(" ")}`);
        snapshot[cat] = {
          before: existing.map((e) => ({ n: e.name, s: e.stockQty, m: e.maxPerStore, h: e.hidden || undefined })),
          after: items.map((e) => ({ n: e.name, s: e.stockQty, m: e.maxPerStore, h: e.hidden || undefined })),
        };
      }
    });
  } catch (e) {
    if (e instanceof PlanError) return { ok: false, error: e.message, cat: e.cat, index: e.index };
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return { ok: false, error: CONFLICT };
    }
    logError("orderPlan.save", e, { date });
    return { ok: false, error: "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요." };
  }

  await writeAudit({
    action: "orderPlan.save",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "OrderPlan",
    targetId: date,
    summary: `${labelDate(date)} 편성 저장 — ${summary.join(" · ")}`,
    snapshot,
  }).catch(() => {});
  revalidatePlan([date]);
  return { ok: true, notices, warnings, updatedAt };
}

// ── 2) 전날 불러오기(초안만, 저장 안 함) ──────────────────────

export async function loadPrevPlanAction(date: string, category: AnyCat): Promise<LoadPrevResult> {
  await requireAdmin();
  if (!isWindowKey(String(date ?? ""))) return { ok: false, error: "날짜가 올바르지 않아요." };
  if (!isAnyCat(category)) return { ok: false, error: "잘못된 종류예요." };
  const src = await prevPlannedDate(date, category as PlanCategory);
  if (!src) return { ok: true, sourceDate: null, items: [], hiddenSeqs: [], notes: ["불러올 지난 편성이 없어요."] };
  const plan = await getDayPlan(src);
  if (category === "TOFU") {
    return { ok: true, sourceDate: src, hiddenSeqs: plan.tofu.hiddenSeqs, notes: [] };
  }
  const all = plan.cats[category].items;
  const visible = all.filter((i) => !i.hidden);
  const notes: string[] = [];
  if (all.length > visible.length) notes.push(`숨긴 품목 ${all.length - visible.length}개는 빼고 불러왔어요.`);
  let drafts: LoadedDraft[] = visible.map((i) => ({
    name: i.name,
    description: i.description,
    stockQty: i.stockQty,
    maxPerStore: i.maxPerStore,
    minPerStore: category === "TOOL" ? i.minPerStore : null,
    inventoryItemId: category === "TOOL" ? i.inventoryItemId : "",
    supplyPrice: i.supplyPrice,
    tax: i.tax,
    hidden: false,
  }));
  if (category === "TOOL") {
    const r = await relinkDrafts(drafts);
    drafts = r.items;
    notes.push(...r.notes);
    const locked = await lockedInventoryItemIds();
    for (const d of drafts) {
      if (d.inventoryItemId && locked.has(d.inventoryItemId)) {
        notes.push(`'${d.name}'은(는) 지금 예약발주 진행 중인 재고라 저장 전에 연동을 풀어 주세요.`);
      }
    }
  }
  return { ok: true, sourceDate: src, items: drafts, notes };
}

// ── 3) 여러 날에 적용(복사) ──────────────────────────────────

export async function copyPlanAction(input: CopyPlanInput): Promise<CopyPlanResult> {
  const admin = await requireAdmin();
  const fromDate = String(input?.fromDate ?? "");
  if (!isWindowKey(fromDate)) return { ok: false, error: "원본 날짜가 올바르지 않아요." };
  const mode = input?.mode === "replace" ? "replace" : "skip";
  // 종류 행 잠금 순서를 저장과 같게(과일→야채→공구→채움채) — 품목 줄은 runPlanTx 설명대로 id 순 한 번에
  const want = new Set((input?.cats ?? []).filter(isAnyCat));
  const cats = ALL_CATS.filter((c) => want.has(c));
  if (cats.length === 0) return { ok: false, error: "적용할 종류를 골라 주세요." };
  const today = windowKeyAt();
  const toDates = [
    ...new Set(
      (input?.toDates ?? [])
        .map((d) => normalizeWindowKey(String(d ?? "")))
        .filter((d) => isWindowKey(d) && d !== fromDate),
    ),
  ].sort();
  if (toDates.length === 0) return { ok: false, error: "적용할 날짜를 골라 주세요." };
  if (toDates.length > 40) return { ok: false, error: "한 번에 40개 발주창까지 적용할 수 있어요." };
  if (toDates.some((d) => d <= today)) return { ok: false, error: "앞으로 올 발주창에만 적용할 수 있어요(오늘·지난 창 제외)." };

  const src = await getDayPlan(fromDate);
  const notes: string[] = [];
  const done: { date: string; cat: AnyCat }[] = [];
  const skipped: { date: string; cat: AnyCat; reason: string }[] = [];

  // 원본 품목 정리(숨김 빼고) + 공구 연동 다시 확인
  const srcItems: Partial<Record<ItemCat, LoadedDraft[]>> = {};
  for (const c of ITEM_CATS) {
    if (!cats.includes(c)) continue;
    if (!src.cats[c].exists) {
      notes.push(`원본(${labelDate(fromDate)})에 ${CAT_LABEL[c]} 편성이 없어 건너뛰었어요.`);
      continue;
    }
    let list: LoadedDraft[] = src.cats[c].items
      .filter((i) => !i.hidden)
      .map((i) => ({
        name: i.name,
        description: i.description,
        stockQty: i.stockQty,
        maxPerStore: i.maxPerStore,
        minPerStore: c === "TOOL" ? i.minPerStore : null,
        inventoryItemId: c === "TOOL" ? i.inventoryItemId : "",
        supplyPrice: i.supplyPrice,
        tax: i.tax,
        hidden: false,
      }));
    if (c === "TOOL") {
      const r = await relinkDrafts(list);
      notes.push(...r.notes);
      const locked = await lockedInventoryItemIds();
      // 저장(saveDayPlanAction)과 같은 공구 검사 — 원본 저장 뒤 재고가 새로 등록·개명됐을 수 있다.
      //  수기 줄 이름이 재고 이름과 같으면 담기원장 없이 계산서가 이름으로 재고를 깎으므로 빼고 안내.
      const manual = r.items.some((d) => !d.inventoryItemId);
      const liveNames = manual
        ? new Set(
            (await prisma.inventoryItem.findMany({ where: { deletedAt: null }, select: { name: true } })).map((x) =>
              normPlanName(x.name),
            ),
          )
        : new Set<string>();
      const linkSeen = new Set<string>();
      list = r.items.filter((d) => {
        if (d.inventoryItemId && locked.has(d.inventoryItemId)) {
          notes.push(`'${d.name}'은(는) 지금 예약발주 진행 중인 재고라 복사하지 않았어요.`);
          return false;
        }
        if (!d.inventoryItemId && liveNames.has(normPlanName(d.name))) {
          notes.push(`'${d.name}'은(는) 재고현황 이름과 같은 수기 공구라 복사하지 않았어요. 재고 연동으로 넣어 주세요.`);
          return false;
        }
        if (d.inventoryItemId) {
          if (linkSeen.has(d.inventoryItemId)) {
            notes.push(`'${d.name}'은(는) 같은 재고에 연동된 줄이 이미 있어 하나만 복사했어요.`);
            return false;
          }
          linkSeen.add(d.inventoryItemId);
        }
        return true;
      });
    }
    // 같은 이름 두 줄은 하나만(저장 검사와 같은 규칙 — 다음 저장이 이름 중복으로 막히지 않게)
    const nameSeen = new Set<string>();
    list = list.filter((d) => {
      const k = normPlanName(d.name);
      if (nameSeen.has(k)) {
        notes.push(`'${d.name}'은(는) 같은 이름 줄이 이미 있어 하나만 복사했어요.`);
        return false;
      }
      nameSeen.add(k);
      return true;
    });
    srcItems[c] = list;
  }
  const doTofu = cats.includes("TOFU");
  if (doTofu && !src.tofu.exists) notes.push(`원본(${labelDate(fromDate)})에 채움채 편성이 없어 건너뛰었어요.`);

  for (const d of toDates) {
    // 이 날짜 결과는 트랜잭션이 끝난 뒤에만 옮겨 적는다(되돌려지거나 다시 시도하면 버림)
    const dDone: { date: string; cat: AnyCat }[] = [];
    const dSkipped: { date: string; cat: AnyCat; reason: string }[] = [];
    try {
      await runPlanTx(async (tx) => {
        dDone.length = 0;
        dSkipped.length = 0;
        // 종류 행을 먼저 전부 잠그고, 덮어쓸 품목 줄은 모아 id 순으로 한 번에 잠근다(저장과 같은 순서)
        const curs = new Map<AnyCat, LockedPlan>();
        for (const c of cats) {
          if (c === "TOFU" ? !src.tofu.exists : !srcItems[c as ItemCat]) continue;
          curs.set(c, await lockPlanRow(tx, d, c));
        }
        if (mode === "replace") {
          await lockItemRows(
            tx,
            [...curs.entries()].flatMap(([c, cur]) => (c !== "TOFU" && cur ? cur.items.map((i) => i.id) : [])),
          );
        }
        for (const [c, cur] of curs) {
          if (cur) {
            if (mode === "skip") {
              dSkipped.push({ date: d, cat: c, reason: "이미 편성돼 있어요" });
              continue;
            }
            if (c !== "TOFU" && cur.items.length > 0) {
              const u = await planUsage(cur.items.map((i) => i.id), tx);
              const any = [...u.values()].some((x) => x.total > 0 || x.byStore.size > 0);
              if (any) {
                dSkipped.push({ date: d, cat: c, reason: "이미 발주가 들어와 덮어쓰지 않았어요" });
                continue;
              }
              await tx.orderPlanItem.deleteMany({ where: { planId: cur.id } });
            }
          }
          if (c === "TOFU") {
            if (cur) {
              await tx.orderPlan.update({ where: { id: cur.id }, data: { hiddenSeqs: src.tofu.hiddenSeqs, updatedBy: admin.id } });
            } else {
              await tx.orderPlan.create({ data: { date: d, category: "TOFU", hiddenSeqs: src.tofu.hiddenSeqs, updatedBy: admin.id } });
            }
          } else {
            const list = srcItems[c as ItemCat] ?? [];
            const plan = cur
              ? await tx.orderPlan.update({ where: { id: cur.id }, data: { updatedBy: admin.id }, select: { id: true } })
              : await tx.orderPlan.create({ data: { date: d, category: c, updatedBy: admin.id }, select: { id: true } });
            if (list.length > 0) {
              await tx.orderPlanItem.createMany({
                data: list.map((it, i) => ({
                  planId: plan.id,
                  date: d,
                  category: c,
                  name: it.name,
                  description: it.description,
                  stockQty: it.stockQty,
                  maxPerStore: it.maxPerStore,
                  minPerStore: it.minPerStore,
                  inventoryItemId: it.inventoryItemId,
                  supplyPrice: it.supplyPrice,
                  tax: it.tax,
                  hidden: false,
                  sortOrder: i,
                })),
              });
            }
          }
          dDone.push({ date: d, cat: c });
        }
      });
      done.push(...dDone);
      skipped.push(...dSkipped);
    } catch (e) {
      // 그 날짜만 실패로 남기고 나머지는 계속
      const reason =
        e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002"
          ? "다른 관리자가 동시에 저장했어요"
          : "저장 중 문제가 생겼어요";
      if (!(e instanceof Prisma.PrismaClientKnownRequestError)) logError("orderPlan.copy", e, { fromDate, date: d });
      for (const c of cats) skipped.push({ date: d, cat: c, reason });
    }
  }

  if (done.length > 0) {
    await writeAudit({
      action: "orderPlan.copy",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "OrderPlan",
      targetId: fromDate,
      summary: `${labelDate(fromDate)} 편성 → ${[...new Set(done.map((x) => x.date))].map(labelDate).join(", ")} (${cats
        .map((c) => CAT_LABEL[c])
        .join("·")}, ${mode === "replace" ? "덮어쓰기" : "건너뛰기"})`,
      snapshot: { done, skipped },
    }).catch(() => {});
    revalidatePlan(done.map((x) => x.date));
  }
  return { ok: true, done, skipped, notes };
}

// ── 4) 스위치 켜기·끄기 ──────────────────────────────────────

/** 그 발주창에 들어온 핫딜 가맹점 발주 수(취소 제외) — 켜기 전 점검과 '다음 창부터' 판정이 같이 쓴다. */
async function windowOrderCount(key: string): Promise<number> {
  const { start, end } = windowCreatedRange(key);
  return prisma.order.count({
    where: {
      status: { not: "CANCELLED" },
      user: { role: "MERCHANT_HOTDEAL" },
      OR: [{ windowKey: key }, { windowKey: null, createdAt: { gte: start, lt: end } }],
    },
  });
}

/**
 * '다음 발주창부터' 시작 창. 정오 전이면 upcomingWindowKey 는 지금 창(오늘)인데,
 * 강제 오픈·지점 시간 열기로 그 창에 이미 발주가 들어왔으면 그 창은 건너뛴다(들어온 발주와 규칙이 섞이지 않게).
 */
async function nextStartKey(now: number, nowOrders?: number): Promise<string> {
  const nowKey = windowKeyAt(now);
  const k = upcomingWindowKey(now);
  if (k !== nowKey) return k;
  const n = nowOrders ?? (await windowOrderCount(nowKey));
  return n > 0 ? nextWindowKey(k) : k;
}

export async function setRestrictModeAction(input: {
  on: boolean;
  when: "next" | "now";
  pilot: string[];
}): Promise<{ ok?: boolean; error?: string }> {
  const admin = await requireAdmin();
  const on = input?.on === true;
  try {
    if (!on) {
      await setRestrictConfig({ on: false });
    } else {
      const raw = [...new Set((input?.pilot ?? []).map((x) => String(x ?? "")).filter(Boolean))];
      let pilot: string[] = [];
      if (raw.length > 0) {
        const ok = await prisma.user.findMany({
          where: { id: { in: raw }, role: "MERCHANT_HOTDEAL" },
          select: { id: true },
        });
        pilot = ok.map((u) => u.id);
        if (pilot.length === 0) return { error: "고른 시험 지점을 찾을 수 없어요. 새로고침 후 다시 골라 주세요." };
      }
      // '지금 바로' = 지금 발주창부터(빈 값으로 두면 켜기 전 지난 창 발주까지 제한 대상으로 잡혀 관리자 수정이 꼬인다)
      const from = input?.when === "now" ? windowKeyAt(Date.now()) : await nextStartKey(Date.now());
      await setRestrictConfig({ on: true, from, pilot });
    }
  } catch (e) {
    logError("orderPlan.mode", e);
    return { error: "스위치를 바꾸지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
  const cfg = await readRestrictConfig().catch(() => null);
  await writeAudit({
    action: "orderPlan.mode",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: on
      ? `품목 제한 모드 켜기 — ${cfg?.from ? `${labelDate(cfg.from)} 발주창부터` : "지금 바로"} · ${
          cfg?.pilot.length ? `시험 지점 ${cfg.pilot.length}곳` : "전 지점"
        }`
      : "품목 제한 모드 끄기",
    snapshot: cfg ? { on: cfg.on, from: cfg.from, pilot: cfg.pilot } : undefined,
  }).catch(() => {});
  revalidatePath("/", "layout");
  revalidatePath("/admin");
  revalidatePath("/admin/order-plan");
  revalidatePath("/admin/order-config");
  revalidatePath("/order");
  return { ok: true };
}

// ── 5) 켜기 전 점검 ──────────────────────────────────────────

export async function restrictPreflightAction(): Promise<PreflightResult> {
  await requireAdmin();
  try {
    const now = Date.now();
    const nowKey = windowKeyAt(now);
    // 지금 창 발주 수를 먼저 — '다음 발주창부터' 시작 창이 이 수에 따라 달라진다(스위치 켜기와 같은 판정)
    const orders = await windowOrderCount(nowKey);
    const nextKey = await nextStartKey(now, orders);
    const keys = nowKey === nextKey ? [nowKey] : [nowKey, nextKey];
    const nowDate = new Date(now);
    const [st, holds, resv, merchants, cfg] = await Promise.all([
      windowStatuses(keys),
      prisma.stockHold.findMany({
        where: { windowDate: nowKey, source: "CART", qty: { gt: 0 } },
        select: { userId: true },
      }),
      prisma.reservationProduct.count({
        where: {
          active: true,
          batch: { active: true },
          OR: [{ pickupDate: { gte: minLockedPickupDate() } }, { closeAt: { gt: nowDate } }],
        },
      }),
      prisma.user.findMany({
        where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
        orderBy: { storeName: "asc" },
        select: { id: true, storeName: true },
      }),
      readRestrictConfig(),
    ]);
    return {
      ok: true,
      nowKey,
      nextKey,
      windows: keys.map((k) => toPreflightWindow(k, st[k])),
      cartHolds: holds.length,
      cartStores: new Set(holds.map((h) => h.userId)).size,
      activeReservations: resv,
      windowOrders: orders,
      merchants,
      config: { on: cfg.on, from: cfg.from, pilot: cfg.pilot },
    };
  } catch (e) {
    logError("orderPlan.preflight", e);
    return { ok: false, error: "점검 정보를 불러오지 못했어요. 잠시 후 다시 시도해 주세요." };
  }
}
