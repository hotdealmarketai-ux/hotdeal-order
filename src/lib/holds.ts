// 담기 현황(관리자) — 지금 살아있는 '담기'를 품목별·점주별로 모아 본다.
//  · 재고현황 담기(StockHold, 현재 발주창)
//  · 예약발주 재고연동 담기(ReservationOrderItem, 아직 미차감·활성 배치)
// 두 소스 모두 같은 기준재고(InventoryItem.qty)를 소비한다 → 남은수량 = base − Σ담기.
// (한 지점이 저재고 품목을 독점하는지 관리자가 확인·재배분하기 위함)
import { prisma } from "@/lib/prisma";
import { windowKeyAt } from "@/lib/schedule";

export type HoldRow = {
  key: string; // React key + 행 식별
  type: "DAILY" | "RESV";
  userId: string;
  storeName: string;
  qty: number;
  itemId: string; // 재고 품목 id(일일 담기 조정 대상)
  resvItemId?: string; // 예약 담기(ReservationOrderItem) id(예약 담기 조정 대상)
  pickupDate?: string; // 예약 담기 픽업일(표시용)
};

export type HoldItem = {
  itemId: string;
  name: string;
  base: number; // 기준재고
  held: number; // Σ담기(일일+예약)
  available: number; // base − held (음수 가능 = 초과)
  rows: HoldRow[];
};

export type HoldsOverview = {
  items: HoldItem[];
  totalHeld: number;
  storeCount: number; // 담고 있는 점포 수
};

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
        user: { select: { storeName: true } },
      },
    }),
    prisma.reservationOrderItem.findMany({
      where: {
        inventoryItemId: { not: "" },
        qty: { gt: 0 },
        stockDeductedAt: null, // 아직 재고정산 전(=살아있는 홀드)
        order: { batch: { active: true } },
      },
      select: {
        id: true,
        inventoryItemId: true,
        name: true,
        qty: true,
        pickupDate: true,
        order: { select: { userId: true, user: { select: { storeName: true } } } },
      },
    }),
  ]);

  const itemIds = new Set<string>();
  for (const d of daily) itemIds.add(d.itemId);
  for (const r of resv) itemIds.add(r.inventoryItemId);
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
    b.held += d.qty;
    stores.add(d.userId);
    b.rows.push({
      key: `d:${d.userId}:${d.itemId}`,
      type: "DAILY",
      userId: d.userId,
      storeName: d.user.storeName,
      qty: d.qty,
      itemId: d.itemId,
    });
  }
  for (const r of resv) {
    const b = ensure(r.inventoryItemId, r.name);
    b.held += r.qty;
    stores.add(r.order.userId);
    b.rows.push({
      key: `r:${r.id}`,
      type: "RESV",
      userId: r.order.userId,
      storeName: r.order.user.storeName,
      qty: r.qty,
      itemId: r.inventoryItemId,
      resvItemId: r.id,
      pickupDate: r.pickupDate,
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
