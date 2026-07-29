import { requireWarehouse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, orderRangeForShipment } from "@/lib/date";
import { heldByItem } from "@/lib/stock-hold";
import { reservationHeldByItem } from "@/lib/reservation-stock";
import { windowKeyAt } from "@/lib/schedule";
import { WarehouseBoard } from "@/components/warehouse/WarehouseBoard";
import type { BoxDTO } from "@/app/actions/warehouse";

export const dynamic = "force-dynamic";

const norm = (s: string) => s.replace(/\s/g, "");

// PC 창고관리 — 위치별 평면도에 재고 품목을 박스로 배치.
export default async function WarehousePage() {
  const user = await requireWarehouse();

  // 재고현황 품목(읽기 전용) — 팔레트에서 박스로 추가할 원본. 유통기한(#9)도 실어 임박 하이라이트.
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, qty: true, expiry: true },
  });
  // 초기 남은수량 = 재고현황 판매가능과 동일: max(0, 기준재고 − Σ담기 − Σ예약홀드). 폴링 전 첫 렌더도 맞춘다.
  const [held, resv] = await Promise.all([
    heldByItem(windowKeyAt()),
    reservationHeldByItem(),
  ]);

  // 인트로/글로우/지점필터 — '오늘 출고할 발주'를 지점별 '나갈 재고(InventoryItem) id 집합'으로.
  //  · 재고현황 담기 = 공구(TOOL) 발주(오늘 출고 = 전날 발주, orderRangeForShipment). 이름→재고 id 매칭.
  //  · 예약 재고연동 = ReservationOrderItem(픽업일 = 오늘, 재고연동).
  // 담기·예약연동이 있는 지점만 싣는다(그 외 지점은 창고와 무관 → 제외). 지점 필터 버튼의 소스.
  const today = kstToday();
  const { start, end } = orderRangeForShipment(today);
  const invByNorm = new Map<string, string>(); // 정규화 이름 → 재고 id(담기 발주 이름매칭)
  for (const it of items) {
    const k = norm(it.name);
    if (k && !invByNorm.has(k)) invByNorm.set(k, it.id);
  }
  const [toolOrders, resvItems] = await Promise.all([
    prisma.order.findMany({
      where: {
        category: "TOOL",
        status: { not: "CANCELLED" },
        createdAt: { gte: start, lt: end },
      },
      select: {
        user: { select: { storeName: true } },
        items: { select: { name: true, rawName: true, qty: true } },
      },
    }),
    prisma.reservationOrderItem.findMany({
      where: {
        pickupDate: today,
        inventoryItemId: { not: "" },
        qty: { gt: 0 },
        order: { batch: { active: true } },
      },
      select: {
        inventoryItemId: true,
        qty: true,
        order: { select: { user: { select: { storeName: true } } } },
      },
    }),
  ]);
  // 지점별 '발주 들어온 수량'을 재고 품목(itemId)별로 집계. (담기 TOOL 발주 수량[문자열 파싱] + 예약연동 수량[정수])
  const parseQty = (s: string) => {
    const n = parseInt(String(s ?? "").replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) ? n : 0;
  };
  const byStore = new Map<string, Map<string, number>>();
  const ensureStore = (s: string) => {
    let v = byStore.get(s);
    if (!v) {
      v = new Map();
      byStore.set(s, v);
    }
    return v;
  };
  for (const o of toolOrders)
    for (const it of o.items) {
      const id = invByNorm.get(norm(it.name || it.rawName || ""));
      if (!id) continue;
      const m = ensureStore(o.user.storeName);
      m.set(id, (m.get(id) ?? 0) + parseQty(it.qty));
    }
  for (const r of resvItems)
    if (r.inventoryItemId) {
      const m = ensureStore(r.order.user.storeName);
      m.set(r.inventoryItemId, (m.get(r.inventoryItemId) ?? 0) + r.qty);
    }

  const storeFilters = [...byStore.entries()]
    .filter(([, m]) => m.size > 0)
    .map(([storeName, m]) => ({
      storeName,
      items: [...m.entries()].map(([itemId, qty]) => ({ itemId, qty })),
    }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
  const todayCount = storeFilters.length; // 나갈 발주가 있는 지점 수

  // 초기 위치(1층) 박스만 서버에서 로드 — 나머지는 탭 전환 시 클라이언트가 불러온다.
  const rows = await prisma.warehouseBox.findMany({
    where: { location: "FLOOR1" },
    orderBy: { z: "asc" },
  });
  const initialBoxes: BoxDTO[] = rows.map((r) => ({
    id: r.id,
    location: r.location,
    itemId: r.itemId,
    label: r.label,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    color: r.color,
    z: r.z,
  }));

  return (
    <WarehouseBoard
      storeName={user.storeName}
      items={items.map((it) => ({
        id: it.id,
        name: it.name,
        qty: Math.max(0, it.qty - (held[it.id] ?? 0) - (resv[it.id] ?? 0)), // 재고현황 판매가능과 동일
        expiry: it.expiry ?? "",
      }))}
      initialLocation="FLOOR1"
      initialBoxes={initialBoxes}
      todayCount={todayCount}
      storeFilters={storeFilters}
    />
  );
}
