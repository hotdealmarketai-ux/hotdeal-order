import { prisma } from "@/lib/prisma";

// 창고 '실물재고' 스냅샷 — 창고관리는 판매가능(base−홀드)이 아니라 '진짜 창고에 있는 수'를 보여줘야 한다.
// 그 수는 재고현황(InventoryItem.qty=base)이고, 출고가 끝난 오전 10시에 실물과 맞는다.
// 그래서 오전 10시(자동)·수동 '동기화' 때 base를 스냅샷으로 떠서, 창고 수량은 이 스냅샷을 보여준다.
// (스냅샷은 재고현황을 '읽기'만 함 — 재고현황 자체는 안 바꾼다.)
const SNAP_KEY = "wh_stock_snap";

export async function snapshotWarehouseStock(): Promise<number> {
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, qty: true },
  });
  const map: Record<string, number> = {};
  for (const it of items) map[it.id] = it.qty;
  await prisma.appMeta.upsert({
    where: { key: SNAP_KEY },
    create: { key: SNAP_KEY, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map), syncedAt: new Date() },
  });
  return items.length;
}

export async function getWarehouseStockSnapshot(): Promise<{
  map: Record<string, number>;
  syncedAt: Date | null;
} | null> {
  const m = await prisma.appMeta.findUnique({ where: { key: SNAP_KEY } });
  if (!m || !m.value) return null;
  try {
    return { map: JSON.parse(m.value) as Record<string, number>, syncedAt: m.syncedAt };
  } catch {
    return null;
  }
}
