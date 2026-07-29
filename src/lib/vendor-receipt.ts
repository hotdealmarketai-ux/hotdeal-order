// 본사 출고 '지점 발주서' 데이터 빌더 — 지점 발주서 화면과 '전체 발주서 인쇄'가 공유(동일 출력).
// 공구(ADMIN_SAEROP 발주 + 확정 예약분) + 채움채(VENDOR_CHAEUMCHAE) + 주간발주.
import { prisma } from "@/lib/prisma";
import { displayQty } from "@/lib/qty";
import { orderRangeForShipment } from "@/lib/date";
import {
  getReservationItemsForStorePickup,
  getReservationStoresForPickup,
} from "@/lib/reservation-data";
import {
  getWeeklyItemsForStoreShipment,
  getWeeklyStoresForShipment,
  type WeeklyShipItem,
} from "@/lib/weekly";

export type ReceiptLine = { name: string; qty: string; note: string; tag?: string };

export type StoreReceipt = {
  merchant: { storeName: string; phone: string | null; address: string | null } | null;
  orders: { confirmed: boolean; edited: boolean }[]; // 발주 확인 상태 표시용
  reservedCount: number;
  toolLines: ReceiptLine[];
  tofuLines: ReceiptLine[];
  weekly: WeeklyShipItem[];
};

// 그 출고일에 본사출고 발주가 있는 지점 목록(공구/채움채 발주 + 예약연동 + 주간발주). 전체 인쇄용.
export async function getVendorStoreList(
  date: string,
): Promise<{ userId: string; storeName: string }[]> {
  const { start, end } = orderRangeForShipment(date);
  const [orders, resvStores, weeklyStores] = await Promise.all([
    prisma.order.findMany({
      where: {
        vendorRole: { in: ["ADMIN_SAEROP", "VENDOR_CHAEUMCHAE"] },
        createdAt: { gte: start, lt: end },
        status: { not: "CANCELLED" },
      },
      select: { userId: true, user: { select: { storeName: true } } },
    }),
    getReservationStoresForPickup(date),
    getWeeklyStoresForShipment(date),
  ]);
  const m = new Map<string, string>();
  for (const o of orders) m.set(o.userId, o.user.storeName);
  for (const s of resvStores) if (!m.has(s.userId)) m.set(s.userId, s.storeName);
  for (const s of weeklyStores) if (!m.has(s.userId)) m.set(s.userId, s.storeName);
  return [...m.entries()]
    .map(([userId, storeName]) => ({ userId, storeName }))
    .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
}

export async function buildStoreReceipt(
  userId: string,
  date: string,
): Promise<StoreReceipt> {
  const { start, end } = orderRangeForShipment(date);
  const [merchant, orders, reserved, weekly] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { storeName: true, phone: true, address: true },
    }),
    prisma.order.findMany({
      where: {
        userId,
        vendorRole: { in: ["ADMIN_SAEROP", "VENDOR_CHAEUMCHAE"] },
        createdAt: { gte: start, lt: end },
        status: { not: "CANCELLED" },
      },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { createdAt: "asc" },
    }),
    getReservationItemsForStorePickup(userId, date),
    // date = 출고일. 그 출고일이 주간발주 출고 요일(기본 수)이면 이 점포 주간발주도 함께.
    getWeeklyItemsForStoreShipment(userId, date),
  ]);

  const toLine = (it: {
    name: string;
    rawName: string;
    qty: string;
    rawQty: string;
    note: string;
    rawNote: string;
  }): ReceiptLine => ({
    name: it.name || it.rawName,
    qty: it.qty || displayQty(it.rawQty),
    note: it.note || it.rawNote,
  });

  const toolLines: ReceiptLine[] = [
    ...orders
      .filter((o) => o.vendorRole === "ADMIN_SAEROP")
      .flatMap((o) => o.items.map(toLine)),
    ...reserved.map((r) => ({ name: r.name, qty: String(r.qty), note: "", tag: "예약" })),
  ];
  const tofuLines: ReceiptLine[] = orders
    .filter((o) => o.vendorRole === "VENDOR_CHAEUMCHAE")
    .flatMap((o) => o.items.map(toLine));

  return {
    merchant,
    orders: orders.map((o) => ({ confirmed: o.confirmed, edited: o.edited })),
    reservedCount: reserved.length,
    toolLines,
    tofuLines,
    weekly,
  };
}
