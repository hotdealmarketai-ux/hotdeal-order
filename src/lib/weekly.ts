// 주간발주 미수/잠금 helper — 일일 발주(receivable.ts)와 완전 독립(kind="WEEKLY", 토요일 주간창 기준).
// 서버 전용.
import { prisma } from "@/lib/prisma";
import { kstDateOf, shiftDate, dowOf } from "@/lib/date";
import {
  currentWeeklyWindowStartUtc,
  nextWeeklyOpenUtc,
  isWeeklyOpen,
} from "@/lib/schedule";
import { orderLockOverride } from "@/lib/order-open";
// 주간발주 상품(DB 카탈로그) 한 줄
export type WeeklyProductRow = {
  code: string;
  category: string;
  name: string;
  perBox: number;
  supplyPrice: number;
  sortOrder: number;
};

// 활성 상품 목록(관리자가 추가/삭제/수정하는 DB 카탈로그). sortOrder 순.
export async function getWeeklyProducts(): Promise<WeeklyProductRow[]> {
  return prisma.weeklyProduct.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      code: true,
      category: true,
      name: true,
      perBox: true,
      supplyPrice: true,
      sortOrder: true,
    },
  });
}

// 코드→상품 맵
export async function weeklyProductMap(): Promise<Record<string, WeeklyProductRow>> {
  const list = await getWeeklyProducts();
  return Object.fromEntries(list.map((p) => [p.code, p]));
}

// 주간발주 상태 배지 — 발주요청 → 발주확인 → 입금대기 → 입금완료(+수정요청). 관리자·점주 공용.
export function weeklyStatusOf(
  order: { confirmed: boolean; edited: boolean } | null,
  invoice: { status: string } | null,
): { label: string; cls: string } {
  if (invoice) {
    if (invoice.status === "PAID") return { label: "입금완료", cls: "badge--ok" };
    return { label: "입금대기", cls: "badge--wait" };
  }
  if (!order) return { label: "발주 없음", cls: "badge--mute" };
  if (order.confirmed) return { label: "발주 확인", cls: "badge--ai" };
  if (order.edited) return { label: "수정 요청", cls: "badge--edit" };
  return { label: "발주 요청", cls: "badge--wait" };
}

// 이번 주간 사이클 키(그 주 토요일 KST 날짜) — 주(週) 식별자.
export function weeklyKeyAt(nowMs: number = Date.now()): string {
  return kstDateOf(new Date(currentWeeklyWindowStartUtc(nowMs)));
}

// 관리자 전역 강제 오픈 토글 — 토요일 12~20시가 아니어도 주간발주를 임의로 열 수 있음.
// AppMeta 키 존재 여부로 on/off(값 필드 없이 presence로). 켜면 끌 때까지 유지.
const WEEKLY_FORCE_KEY = "weekly_force_open";
export async function weeklyForceOpen(): Promise<boolean> {
  const m = await prisma.appMeta.findUnique({ where: { key: WEEKLY_FORCE_KEY } });
  return !!m;
}
export async function setWeeklyForceOpen(on: boolean): Promise<void> {
  if (on) {
    await prisma.appMeta.upsert({
      where: { key: WEEKLY_FORCE_KEY },
      create: { key: WEEKLY_FORCE_KEY },
      update: { syncedAt: new Date() },
    });
  } else {
    await prisma.appMeta.deleteMany({ where: { key: WEEKLY_FORCE_KEY } });
  }
}
// 지금 주간발주가 열려있는가 = 토요일 창 OR 관리자 강제 오픈.
export async function weeklyOpenNow(nowMs: number = Date.now()): Promise<boolean> {
  if (isWeeklyOpen(nowMs)) return true;
  return weeklyForceOpen();
}

// 해제(unlock)가 겨냥하는 주간 사이클 키. 주간창이 열려있을 때 누르면 그 주,
// 창 밖(주중·마감후)에 누르면 '다음 토요일 주간창'을 겨냥한 것으로 본다(1회성 유지).
function unlockTargetWeeklyKey(unlockMs: number): string {
  const target = isWeeklyOpen(unlockMs)
    ? currentWeeklyWindowStartUtc(unlockMs)
    : nextWeeklyOpenUtc(unlockMs);
  return kstDateOf(new Date(target));
}

// 주간 수동 해제가 '이번(현재) 주간 사이클'에 유효한가(1회성). 잠금판정과 화면 배지가 공유.
export function isWeeklyUnlockActive(
  weeklyOrderUnlock: boolean,
  weeklyOrderUnlockAt?: Date | null,
  nowMs: number = Date.now(),
): boolean {
  return (
    weeklyOrderUnlock &&
    !!weeklyOrderUnlockAt &&
    unlockTargetWeeklyKey(weeklyOrderUnlockAt.getTime()) === weeklyKeyAt(nowMs)
  );
}

// 주간 미수(발행·미입금 WEEKLY 계산서 합) + 건수
export async function weeklyReceivableOf(
  userId: string,
): Promise<{ balance: number; count: number }> {
  const ar = await prisma.invoice.aggregate({
    where: { userId, status: "ISSUED", kind: "WEEKLY" },
    _sum: { total: true },
    _count: true,
  });
  return { balance: ar._sum.total ?? 0, count: ar._count };
}

// 주간 발주 잠금: '이번 주간창 시작 이전에 발행된' 미입금 주간 입금요청서가 있으면 이번 주간발주 잠금.
// (주간 요청서는 출고일(수)에 발행 → 다음 토요일 12시 전까지 입금해야 함. 안 되면 그 주 주간발주 못 넣음.)
export async function weeklyLockOf(
  userId: string,
  weeklyOrderUnlock: boolean,
  weeklyOrderUnlockAt?: Date | null,
): Promise<{ locked: boolean; unpaidDate: string | null; unpaidTotal: number }> {
  // 전체 잠금해제 토글 ON → 미수 있어도 주간발주 허용.
  if (await orderLockOverride()) return { locked: false, unpaidDate: null, unpaidTotal: 0 };
  const now = Date.now();
  const windowStart = new Date(currentWeeklyWindowStartUtc(now));
  const unlockedThisWeek = isWeeklyUnlockActive(
    weeklyOrderUnlock,
    weeklyOrderUnlockAt,
    now,
  );
  const past = await prisma.invoice.findFirst({
    where: {
      userId,
      kind: "WEEKLY",
      status: "ISSUED",
      issuedAt: { lt: windowStart },
    },
    orderBy: { issuedAt: "asc" },
    select: { date: true, total: true },
  });
  return {
    locked: !!past && !unlockedThisWeek,
    unpaidDate: past?.date ?? null,
    unpaidTotal: past?.total ?? 0,
  };
}

// 주간 미수(ISSUED WEEKLY)가 모두 정산되면 관리자 임의 잠금해제를 자동 원복.
export async function clearWeeklyUnlockIfSettled(userId: string) {
  const remaining = await prisma.invoice.count({
    where: { userId, status: "ISSUED", kind: "WEEKLY" },
  });
  if (remaining === 0) {
    await prisma.user.updateMany({
      where: { id: userId, weeklyOrderUnlock: true },
      data: { weeklyOrderUnlock: false, weeklyOrderUnlockAt: null },
    });
  }
}

// ============================================================
//  주간발주 출고일(기본 수요일) — 관리자 설정 + 출고일↔주간사이클 매핑.
//  주간발주는 토요일에 넣고(weekKey=그 토요일), 설정된 요일(기본 수요일)에 출고한다.
//  그 출고일의 발주서(본사출고·핫딜마켓 발주·전체 발주 목록)에 주간발주도 함께 실린다.
// ============================================================
// 출고 요일 설정 — AppMeta는 값 컬럼이 없어 키에 값을 인코딩("weekly_ship_dow:3").
// 없으면 기본 3(수요일). 월~금(1~5)만 허용(토요일 발주 후 출고).
const SHIP_DOW_PREFIX = "weekly_ship_dow:";
export const WEEKLY_SHIP_DOW_DEFAULT = 3; // 수요일

export async function weeklyShipDow(): Promise<number> {
  const m = await prisma.appMeta.findFirst({
    where: { key: { startsWith: SHIP_DOW_PREFIX } },
  });
  if (!m) return WEEKLY_SHIP_DOW_DEFAULT;
  const n = parseInt(m.key.slice(SHIP_DOW_PREFIX.length), 10);
  return Number.isInteger(n) && n >= 1 && n <= 5 ? n : WEEKLY_SHIP_DOW_DEFAULT;
}

export async function setWeeklyShipDow(dow: number): Promise<void> {
  const d =
    Number.isInteger(dow) && dow >= 1 && dow <= 5 ? dow : WEEKLY_SHIP_DOW_DEFAULT;
  await prisma.appMeta.deleteMany({ where: { key: { startsWith: SHIP_DOW_PREFIX } } });
  await prisma.appMeta.create({ data: { key: `${SHIP_DOW_PREFIX}${d}` } });
}

// 토요일(weekKey)에서 출고일까지의 일수. 월~금=2~6일(예: 수요일=4).
export function weeklyShipOffsetDays(shipDow: number): number {
  const off = (((shipDow - 6) % 7) + 7) % 7;
  return off === 0 ? 7 : off;
}

// 주간 사이클(토요일 weekKey) → 출고일 YYYY-MM-DD.
export function weeklyShipmentDayForKey(weekKey: string, shipDow: number): string {
  return shiftDate(weekKey, weeklyShipOffsetDays(shipDow));
}

// 출고일 → 그 날 출고되는 주간 사이클(토요일 weekKey). 출고일이 설정 요일이 아니면 null.
export function weeklyKeyForShipmentDay(
  shipmentDay: string,
  shipDow: number,
): string | null {
  if (dowOf(shipmentDay) !== shipDow) return null;
  return shiftDate(shipmentDay, -weeklyShipOffsetDays(shipDow));
}

export type WeeklyShipItem = {
  code: string;
  category: string; // SNACK | DAIRY | DRIED | EGG
  name: string;
  boxUnit: string; // 표시 단위(예: "1박스 30개", 계란=판/구)
  qty: number; // 발주 박스/판 수
  unitPrice: number; // 박스/판 공급가
  amount: number; // qty × unitPrice
};

// 한 점포의 '그 출고일' 주간발주 품목(확정분). 발주서 표시·계산서 불러오기 공용.
// 출고일이 설정 요일(기본 수)이 아니거나, 확정된 주간발주가 없으면 빈 배열.
export async function getWeeklyItemsForStoreShipment(
  userId: string,
  shipmentDay: string,
): Promise<WeeklyShipItem[]> {
  const weekKey = weeklyKeyForShipmentDay(shipmentDay, await weeklyShipDow());
  if (!weekKey) return [];
  const order = await prisma.weeklyOrder.findUnique({
    where: { userId_weekKey: { userId, weekKey } },
    include: { items: { where: { qty: { gt: 0 } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!order || !order.confirmed) return [];
  return order.items.map((it) => ({
    code: it.code,
    category: it.category,
    name: it.name,
    boxUnit: it.boxUnit,
    qty: it.qty,
    unitPrice: it.unitPrice,
    amount: it.qty * it.unitPrice,
  }));
}

// '그 출고일'에 주간발주가 실리는 점포 목록(확정분). 주간발주만 있는 점포도 발주 목록에 뜨게.
export async function getWeeklyStoresForShipment(
  shipmentDay: string,
): Promise<{ userId: string; storeName: string; count: number; qty: number }[]> {
  const weekKey = weeklyKeyForShipmentDay(shipmentDay, await weeklyShipDow());
  if (!weekKey) return [];
  const orders = await prisma.weeklyOrder.findMany({
    where: { weekKey, confirmed: true },
    include: {
      user: { select: { storeName: true } },
      items: { where: { qty: { gt: 0 } }, select: { qty: true } },
    },
  });
  return orders
    .map((o) => ({
      userId: o.userId,
      storeName: o.user.storeName,
      count: o.items.length,
      qty: o.items.reduce((n, it) => n + it.qty, 0),
    }))
    .filter((o) => o.count > 0)
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
}
