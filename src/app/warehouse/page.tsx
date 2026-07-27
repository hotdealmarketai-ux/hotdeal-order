import { requireWarehouse } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { WarehouseBoard } from "@/components/warehouse/WarehouseBoard";
import type { BoxDTO } from "@/app/actions/warehouse";

export const dynamic = "force-dynamic";

// PC 창고관리 — 위치별 평면도에 재고 품목을 박스로 배치.
export default async function WarehousePage() {
  const user = await requireWarehouse();

  // 재고현황 품목(읽기 전용) — 팔레트에서 박스로 추가할 원본.
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, qty: true },
  });

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
      items={items}
      initialLocation="FLOOR1"
      initialBoxes={initialBoxes}
    />
  );
}
