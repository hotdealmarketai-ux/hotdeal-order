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

  // 인트로/글로우 — '오늘 출고할 발주' = 전날 발주(발주=전날, 출고=다음날 공식).
  // 그래서 오늘(kstToday) 출고에 실리는 발주 범위(orderRangeForShipment)로 조회한다(취소 제외).
  const { start, end } = orderRangeForShipment(kstToday());
  const todayOrders = await prisma.order.findMany({
    where: { createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    select: {
      user: { select: { storeName: true } },
      items: { select: { name: true, rawName: true } },
    },
  });
  const todayStores = [...new Set(todayOrders.map((o) => o.user.storeName))];
  // '오늘 출고 발주 N건' = 오늘 출고할 발주를 넣은 지점 수(지점 8곳이면 8건).
  const todayCount = todayStores.length;
  const todayItemNames = [
    ...new Set(
      todayOrders.flatMap((o) =>
        o.items.map((it) => norm(it.name || it.rawName || "")).filter((n) => n.length >= 2),
      ),
    ),
  ];

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
      todayStores={todayStores}
      todayItemNames={todayItemNames}
    />
  );
}
