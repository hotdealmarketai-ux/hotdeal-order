// 담기 현황(관리자) — 지금 살아있는 '담기'를 품목별·점주별로 모아 본다.
//  · 재고현황 담기(StockHold source=CART, 현재 발주창)
//  · 품목 제한 모드 연동 공구 발주분(StockHold source=PLAN, 현재 발주창) — 발주 저장 때 서버가 맞추므로 여기서 조정 금지
//  · 예약발주 재고연동 담기(ReservationOrderItem, 아직 미차감·활성 배치·픽업 10시 전, 세트는 구성품으로 전개)
// 세 소스 모두 같은 기준재고(InventoryItem.qty)를 소비한다 → 남은수량 = base − Σ담기.
// 예약 집계 규칙은 reservation-stock.ts reservationHeldByItem 과 똑같다(점주 화면·편성 가용과 같은 숫자).
// (한 지점이 저재고 품목을 독점하는지 관리자가 확인·재배분하기 위함)
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { windowKeyAt } from "@/lib/schedule";
import { minLockedPickupDate } from "@/lib/reservation-stock";

type Db = typeof prisma | Prisma.TransactionClient;

export type HoldRow = {
  key: string; // React key + 행 식별
  type: "DAILY" | "PLAN" | "RESV"; // PLAN = 제한 모드 공구 발주분
  userId: string;
  storeName: string;
  qty: number;
  itemId: string; // 재고 품목 id(일일 담기 조정 대상)
  resvItemId?: string; // 예약 담기(ReservationOrderItem) id(예약 담기 조정 대상)
  pickupDate?: string; // 예약 담기 픽업일(표시용)
  setName?: string; // 세트 예약을 구성품으로 전개한 줄이면 세트 이름(표시용)
  lockedReason?: string; // 있으면 −/+ 조정 막음(이유 안내)
};

export type HoldItem = {
  itemId: string;
  name: string;
  base: number; // 기준재고
  held: number; // Σ담기(일일+발주분+예약)
  available: number; // base − held (음수 가능 = 초과)
  rows: HoldRow[];
};

export type HoldsOverview = {
  items: HoldItem[];
  totalHeld: number;
  storeCount: number; // 담고 있는 점포 수
};

export const PLAN_HOLD_LOCKED = "발주분이에요. 발주 수정에서 바꿔 주세요.";
const SET_HOLD_LOCKED = "세트 예약이에요. 예약 화면에서 바꿔 주세요.";

export type ResvHoldRow = {
  resvItemId: string; // 예약 주문 줄 id
  itemId: string; // 소비하는 재고 품목 id(세트면 구성품)
  name: string;
  qty: number; // 이 재고 품목 기준 수량(세트면 세트수×세트당수량)
  pickupDate: string;
  userId: string;
  storeName: string;
  setName?: string; // 세트 전개 줄이면 세트(주문 줄) 이름
};

/**
 * 살아 있는 예약 홀드를 재고 품목 기준 줄로 — reservationHeldByItem 과 같은 규칙:
 *  단일 연동 줄(inventoryItemId 있음) + 세트 줄의 연동 구성품 전개, 미차감·수량>0·활성 배치·픽업 10시 전(minLockedPickupDate).
 * itemId 를 주면 그 재고 품목만.
 */
export async function reservationHoldRows(db: Db = prisma, itemId?: string): Promise<ResvHoldRow[]> {
  const gte = minLockedPickupDate();
  const live = {
    stockDeductedAt: null,
    qty: { gt: 0 },
    pickupDate: { gte },
    order: { batch: { active: true } },
  } satisfies Prisma.ReservationOrderItemWhereInput;
  const orderSel = { select: { userId: true, user: { select: { storeName: true } } } } as const;

  const [singles, sets] = await Promise.all([
    db.reservationOrderItem.findMany({
      where: { ...live, inventoryItemId: itemId ? itemId : { not: "" } },
      select: { id: true, inventoryItemId: true, name: true, qty: true, pickupDate: true, order: orderSel },
    }),
    db.reservationProduct.findMany({
      where: {
        active: true,
        components: { some: { inventoryItemId: itemId ? itemId : { not: "" } } },
      },
      select: {
        id: true,
        components: {
          where: { inventoryItemId: itemId ? itemId : { not: "" } },
          select: { inventoryItemId: true, name: true, qtyPerUnit: true },
        },
      },
    }),
  ]);

  const out: ResvHoldRow[] = singles.map((r) => ({
    resvItemId: r.id,
    itemId: r.inventoryItemId,
    name: r.name,
    qty: r.qty,
    pickupDate: r.pickupDate,
    userId: r.order.userId,
    storeName: r.order.user.storeName,
  }));

  if (sets.length > 0) {
    const compsByProduct = new Map(sets.map((s) => [s.id, s.components]));
    const setItems = await db.reservationOrderItem.findMany({
      where: { ...live, productId: { in: sets.map((s) => s.id) } },
      select: { id: true, productId: true, name: true, qty: true, pickupDate: true, order: orderSel },
    });
    for (const it of setItems) {
      for (const c of compsByProduct.get(it.productId) ?? []) {
        out.push({
          resvItemId: it.id,
          itemId: c.inventoryItemId,
          name: c.name,
          qty: it.qty * c.qtyPerUnit,
          pickupDate: it.pickupDate,
          userId: it.order.userId,
          storeName: it.order.user.storeName,
          setName: it.name,
        });
      }
    }
  }
  return out;
}

export async function getHoldsOverview(): Promise<HoldsOverview> {
  const windowDate = windowKeyAt();
  const [daily, resv] = await Promise.all([
    prisma.stockHold.findMany({
      where: { windowDate, qty: { gt: 0 } },
      select: {
        userId: true,
        itemId: true,
        name: true,
        qty: true,
        source: true,
        user: { select: { storeName: true } },
      },
    }),
    reservationHoldRows(),
  ]);

  const itemIds = new Set<string>();
  for (const d of daily) itemIds.add(d.itemId);
  for (const r of resv) itemIds.add(r.itemId);
  const invItems = itemIds.size
    ? await prisma.inventoryItem.findMany({
        where: { id: { in: [...itemIds] } },
        select: { id: true, name: true, qty: true },
      })
    : [];
  const meta = new Map(invItems.map((i) => [i.id, { name: i.name, base: i.qty }]));

  const bucket = new Map<string, HoldItem>();
  const ensure = (itemId: string, fallbackName: string): HoldItem => {
    let b = bucket.get(itemId);
    if (!b) {
      const m = meta.get(itemId);
      b = {
        itemId,
        name: m?.name ?? fallbackName,
        base: m?.base ?? 0,
        held: 0,
        available: 0,
        rows: [],
      };
      bucket.set(itemId, b);
    }
    return b;
  };

  const stores = new Set<string>();
  for (const d of daily) {
    const b = ensure(d.itemId, d.name);
    const isPlan = d.source === "PLAN";
    b.held += d.qty;
    stores.add(d.userId);
    b.rows.push({
      key: `d:${d.userId}:${d.itemId}`,
      type: isPlan ? "PLAN" : "DAILY",
      userId: d.userId,
      storeName: d.user.storeName,
      qty: d.qty,
      itemId: d.itemId,
      ...(isPlan ? { lockedReason: PLAN_HOLD_LOCKED } : {}),
    });
  }
  for (const r of resv) {
    const b = ensure(r.itemId, r.name);
    b.held += r.qty;
    stores.add(r.userId);
    b.rows.push({
      key: r.setName ? `s:${r.resvItemId}:${r.itemId}` : `r:${r.resvItemId}`,
      type: "RESV",
      userId: r.userId,
      storeName: r.storeName,
      qty: r.qty,
      itemId: r.itemId,
      pickupDate: r.pickupDate,
      ...(r.setName
        ? { setName: r.setName, lockedReason: SET_HOLD_LOCKED }
        : { resvItemId: r.resvItemId }),
    });
  }

  const items = [...bucket.values()].map((b) => ({
    ...b,
    available: b.base - b.held,
  }));
  // 행: 많이 담은 점포 먼저(독점 확인)
  for (const b of items)
    b.rows.sort((a, z) => z.qty - a.qty || a.storeName.localeCompare(z.storeName, "ko"));
  // 품목: 남은수량 적은(경쟁 심한) 것 먼저 → 그다음 많이 담긴 순
  items.sort(
    (a, z) =>
      a.available - z.available ||
      z.held - a.held ||
      a.name.localeCompare(z.name, "ko"),
  );

  const totalHeld = items.reduce((n, b) => n + b.held, 0);
  return { items, totalHeld, storeCount: stores.size };
}
