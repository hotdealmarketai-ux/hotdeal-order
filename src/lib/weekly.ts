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
import { receivableOf } from "@/lib/receivable";
import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";
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
    select: { id: true },
  });
  if (!past) return { locked: false, unpaidDate: null, unpaidTotal: 0 };
  // 계산서 개별 '입금확인'을 없애(2026-08-05~) 결제 후에도 ISSUED로 남으므로, '낱장 정산'이 아니라 '지점 총미수
  // (receivableOf)'로 판정한다(매칭이 지점 단위 → 낱장 추정은 부정확·이중납부 위험이라 폐기). 안내 금액도 지점 총미수.
  const { balance } = await receivableOf(userId);
  return {
    locked: !unlockedThisWeek && balance > 0,
    unpaidDate: null,
    unpaidTotal: Math.max(0, balance),
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

// ── 카테고리별 출고 요일 ─────────────────────────────────────
// 카테고리(계란/유제품/…)마다 출고 요일이 다를 수 있다 → AppMeta.value 에 JSON {category: dow} 저장.
// 미설정 카테고리는 기존 전역 설정(weeklyShipDow)을 기본값으로 사용(하위호환).
const SHIP_DOW_BY_CAT_KEY = "weekly_ship_dow_by_cat";

// 전 카테고리의 출고요일 맵. 항상 모든 카테고리 키를 채워서 반환(미설정=전역 기본).
export async function weeklyShipDowByCategory(): Promise<Record<string, number>> {
  const [m, fallback] = await Promise.all([
    prisma.appMeta.findUnique({ where: { key: SHIP_DOW_BY_CAT_KEY } }),
    weeklyShipDow(),
  ]);
  let saved: Record<string, unknown> = {};
  if (m?.value) {
    try {
      const j = JSON.parse(m.value);
      if (j && typeof j === "object") saved = j as Record<string, unknown>;
    } catch {
      /* 손상된 값 → 전역 기본으로 폴백 */
    }
  }
  const out: Record<string, number> = {};
  for (const c of WEEKLY_CATEGORIES) {
    const v = saved[c.key];
    out[c.key] =
      typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : fallback;
  }
  return out;
}

// 한 카테고리의 출고요일 설정(월~금). 나머지 카테고리 설정은 보존.
export async function setWeeklyShipDowForCategory(
  category: string,
  dow: number,
): Promise<void> {
  const valid = WEEKLY_CATEGORIES.some((c) => c.key === category);
  if (!valid) return;
  const d =
    Number.isInteger(dow) && dow >= 1 && dow <= 5 ? dow : WEEKLY_SHIP_DOW_DEFAULT;
  const m = await prisma.appMeta.findUnique({ where: { key: SHIP_DOW_BY_CAT_KEY } });
  let map: Record<string, number> = {};
  if (m?.value) {
    try {
      const j = JSON.parse(m.value);
      if (j && typeof j === "object") map = j as Record<string, number>;
    } catch {
      /* 무시 — 새로 쓴다 */
    }
  }
  map[category] = d;
  await prisma.appMeta.upsert({
    where: { key: SHIP_DOW_BY_CAT_KEY },
    create: { key: SHIP_DOW_BY_CAT_KEY, value: JSON.stringify(map) },
    update: { value: JSON.stringify(map), syncedAt: new Date() },
  });
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

// 카테고리별 출고요일이 달라 '어느 요일이든' 그 주 토요일 사이클을 가리킨다.
// 월~금이면 항상 그 전 토요일(월=2일 전 … 금=6일 전) weekKey, 토·일은 출고 없음(null).
export function weeklyKeyForAnyShipmentDay(shipmentDay: string): string | null {
  const d = dowOf(shipmentDay);
  if (d < 1 || d > 5) return null;
  return shiftDate(shipmentDay, -weeklyShipOffsetDays(d));
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

// 그 출고일의 dow 에 출고되는 카테고리 집합. 없으면 빈 Set(그 날 나가는 주간발주 없음).
async function categoriesShippingOn(shipmentDay: string): Promise<Set<string>> {
  const dow = dowOf(shipmentDay);
  const byCat = await weeklyShipDowByCategory();
  return new Set(Object.keys(byCat).filter((c) => byCat[c] === dow));
}

// 한 점포의 '그 출고일' 주간발주 품목. 발주서 표시·계산서 불러오기 공용.
// 카테고리별 출고요일에 맞는 품목만(그 dow 에 출고되는 카테고리). 토·일이거나 그 날 나갈 카테고리가 없으면 빈 배열.
// requireConfirmed(기본 false): 주간발주는 있으면 출고일에 발주서/계산서에 무조건 넘어온다
//   (발주 확인은 주간발주 탭에서 하는 관리용 상태일 뿐, 표시 게이트 아님). true로 주면 확정분만.
export async function getWeeklyItemsForStoreShipment(
  userId: string,
  shipmentDay: string,
  opts?: { requireConfirmed?: boolean },
): Promise<WeeklyShipItem[]> {
  const requireConfirmed = opts?.requireConfirmed ?? false;
  const weekKey = weeklyKeyForAnyShipmentDay(shipmentDay);
  if (!weekKey) return [];
  const cats = await categoriesShippingOn(shipmentDay);
  if (cats.size === 0) return [];
  const order = await prisma.weeklyOrder.findUnique({
    where: { userId_weekKey: { userId, weekKey } },
    include: { items: { where: { qty: { gt: 0 } }, orderBy: { sortOrder: "asc" } } },
  });
  if (!order) return [];
  if (requireConfirmed && !order.confirmed) return [];
  return order.items
    .filter((it) => cats.has(it.category)) // 오늘 출고 요일인 카테고리만
    .map((it) => ({
      code: it.code,
      category: it.category,
      name: it.name,
      boxUnit: it.boxUnit,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.qty * it.unitPrice,
    }));
}

// '그 출고일'에 주간발주가 실리는 점포 목록. 주간발주만 있는 점포도(발주 확인 전이라도) 발주 목록에 뜨게.
// 그 dow 에 출고되는 카테고리 품목이 있는 점포만.
export async function getWeeklyStoresForShipment(
  shipmentDay: string,
): Promise<{ userId: string; storeName: string; count: number; qty: number }[]> {
  const weekKey = weeklyKeyForAnyShipmentDay(shipmentDay);
  if (!weekKey) return [];
  const cats = await categoriesShippingOn(shipmentDay);
  if (cats.size === 0) return [];
  const orders = await prisma.weeklyOrder.findMany({
    where: { weekKey },
    include: {
      user: { select: { storeName: true } },
      items: { where: { qty: { gt: 0 } }, select: { qty: true, category: true } },
    },
  });
  return orders
    .map((o) => {
      const today = o.items.filter((it) => cats.has(it.category));
      return {
        userId: o.userId,
        storeName: o.user.storeName,
        count: today.length,
        qty: today.reduce((n, it) => n + it.qty, 0),
      };
    })
    .filter((o) => o.count > 0)
    .sort((a, b) => a.storeName.localeCompare(b.storeName));
}
