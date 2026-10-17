// 공산품(옛 예약발주) 재구조화 — 신규 '단일 목록' 방식(상품별 마감 closeAt). prisma read/헬퍼.
// 날짜 뎁스(ReservationBatch reserveDate) 대신 상품별 closeAt 이 마감을 결정.
// 신규 상품은 모두 상시(evergreen) 배치 하나에 모은다(reserveDate 센티널). 레거시 배치와 분리.
// ⚠ 이 파일은 prisma 를 import 하므로 서버 전용 — 클라이언트 부품은 타입만 가져다 쓴다(import type).
import { prisma } from "@/lib/prisma";
import { flatQtyProblem } from "@/lib/flat-qty-rule";
import { STATUS_LABEL, type Status } from "@/lib/constants";

// 신규 flat 상품을 담는 상시 배치의 예약일자 센티널(정렬/마감에 안 쓰임).
export const FLAT_RESERVE_KEY = "__flat__";

// KST 오늘(YYYY-MM-DD). 픽업일(문자열) 비교로 '지난 픽업 마감' 판정에 사용.
export function kstTodayStr(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// flat 예약상품 목록의 범위.
//  · open        : 마감 전(진행 중)                         closeAt > now
//  · closed      : 예약 마감 지남 · 픽업일 안 지남(지난 예약 마감)  closeAt ≤ now, pickup ≥ 오늘
//  · pickupClosed: 예약 마감 + 픽업일까지 지남(지난 픽업 마감)     closeAt ≤ now, pickup < 오늘
export type FlatScope = "open" | "closed" | "pickupClosed";

// scope별 reservationProduct where 조각(active·closeAt·pickupDate).
function flatScopeWhere(scope: FlatScope, now: Date) {
  const today = kstTodayStr(now);
  const closeAt = scope === "open" ? { gt: now } : { lte: now };
  const where: {
    active: true;
    closeAt: { gt: Date } | { lte: Date };
    pickupDate?: { gte: string } | { lt: string };
  } = { active: true, closeAt };
  // 픽업일(문자열 YYYY-MM-DD)로 마감분을 둘로 가른다. lexicographic 비교로 충분.
  if (scope === "closed") where.pickupDate = { gte: today };
  else if (scope === "pickupClosed") where.pickupDate = { lt: today };
  return where;
}

// 상시 배치 id 확보(없으면 생성). 신규 상품/주문이 여기 붙는다.
export async function getOrCreateFlatBatchId(): Promise<string> {
  const found = await prisma.reservationBatch.findUnique({
    where: { reserveDate: FLAT_RESERVE_KEY },
    select: { id: true },
  });
  if (found) return found.id;
  const created = await prisma.reservationBatch.create({
    data: { reserveDate: FLAT_RESERVE_KEY, pickupDate: FLAT_RESERVE_KEY, active: true },
    select: { id: true },
  });
  return created.id;
}

export type FlatProductRow = {
  id: string;
  name: string;
  pickupDate: string; // 출고일(= 계산서 날짜)
  supplyPrice: number;
  inventoryItemId: string;
  closeAt: Date;
  closeAtMs: number; // closeAt.getTime() — 마감 묶음(groupFlatByClose)용
  stockFixed: boolean; // 재고 고정(초과발주 금지)
  minPerStore: number | null; // 지점당 최소(null = 없음)
  description: string; // 점주 안내 한 줄("" = 없음)
  totalQty: number; // 취합 수량(전 점포 합)
  storeCount: number; // 발주 점포 수
  components: { name: string; inventoryItemId: string; qtyPerUnit: number; supplyPrice: number }[];
};

// 관리자 flat 상품 목록. open=마감 전(임박순), closed=지난 예약 마감(픽업 전), pickupClosed=지난 픽업 마감.
export async function listFlatProductsAdmin(
  scope: FlatScope,
  now: Date = new Date(),
): Promise<FlatProductRow[]> {
  const products = await prisma.reservationProduct.findMany({
    where: flatScopeWhere(scope, now),
    orderBy: { closeAt: scope === "open" ? "asc" : "desc" },
    select: {
      id: true,
      name: true,
      pickupDate: true,
      supplyPrice: true,
      inventoryItemId: true,
      closeAt: true,
      stockFixed: true,
      minPerStore: true,
      description: true,
      components: {
        orderBy: { sortOrder: "asc" },
        select: { name: true, inventoryItemId: true, qtyPerUnit: true, supplyPrice: true },
      },
    },
  });
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);
  const items = await prisma.reservationOrderItem.findMany({
    where: {
      productId: { in: ids },
      qty: { gt: 0 },
      // 확정분만 집계 — 연동 상품의 '담기만 하고 미확정'인 홀드는 공구/계산서로 안 나가고 마감 후 해제되므로
      // '총 N개 · 점포'가 움직이는 값이 되지 않도록(= 실제 발주될 수량과 일치). 확정 조건은 출고·계산서와 같게.
      order: { batch: { active: true } },
      OR: [{ confirmedAt: { not: null } }, { order: { confirmed: true } }],
    },
    select: { productId: true, qty: true, order: { select: { userId: true } } },
  });
  const agg = new Map<string, { qty: number; stores: Set<string> }>();
  for (const it of items) {
    const a = agg.get(it.productId) ?? { qty: 0, stores: new Set<string>() };
    a.qty += it.qty;
    a.stores.add(it.order.userId);
    agg.set(it.productId, a);
  }

  const rows = products.map((p) => {
    const a = agg.get(p.id);
    return {
      id: p.id,
      name: p.name,
      pickupDate: p.pickupDate,
      supplyPrice: p.supplyPrice,
      inventoryItemId: p.inventoryItemId,
      closeAt: p.closeAt as Date,
      closeAtMs: (p.closeAt as Date).getTime(),
      stockFixed: p.stockFixed,
      minPerStore: p.minPerStore,
      description: p.description,
      totalQty: a?.qty ?? 0,
      storeCount: a?.stores.size ?? 0,
      components: p.components,
    };
  });
  // 정렬: ①마감 임박순(closeAt) ②같은 마감시각이면 ㄱㄴㄷ(이름). DB 콜레이션 대신 JS localeCompare로 한글 순서 보장.
  rows.sort((a, b) => {
    const ca = a.closeAt.getTime();
    const cb = b.closeAt.getTime();
    if (ca !== cb) return scope === "open" ? ca - cb : cb - ca;
    return a.name.localeCompare(b.name, "ko");
  });
  return rows;
}

export type FlatMerchantRow = {
  id: string;
  name: string;
  pickupDate: string; // 출고일(= 계산서 날짜)
  supplyPrice: number;
  inventoryItemId: string;
  closeAtMs: number;
  minPerStore: number | null; // 지점당 최소(null = 없음)
  description: string; // 점주 안내 한 줄("" = 없음)
  myQty: number; // 내 줄에 저장된 수량(확정·미확정 모두, 세트면 세트 수)
  myConfirmed: boolean; // 내 줄이 확정됐는가(품목 confirmedAt 또는 옛 주문 confirmed — 출고·계산서와 같은 조건)
  myConfirmedQty: number; // 출고·계산서로 나가는 내 수량(확정분만, 미확정이면 0). 수량 규칙 검사의 '지금 저장된 내 수량'
  available: number; // 재고연동 상품의 남은수량(세트면 담을 수 있는 세트 수, 수기는 무시)
  stockFixed: boolean; // 재고 고정(초과발주 금지) — false면 재고 넘어 담기 가능
  components: { name: string; qtyPerUnit: number }[]; // 세트 구성품(비어있으면 단일 상품)
  isSet: boolean;
  hasLinked: boolean; // 재고연동(단일 또는 세트 구성품) — true면 holdFlatProductAction, false면 confirmFlatProductAction
};

// 점주 flat 상품 목록. scope "open"=마감 전(임박순), "closed"=마감 후. 재고연동 상품은 남은수량 시드.
export async function listFlatProductsMerchant(
  userId: string,
  scope: "open" | "closed",
  now: Date = new Date(),
): Promise<FlatMerchantRow[]> {
  const { availableForReservationProducts } = await import("@/lib/reservation-stock");
  const products = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      closeAt: scope === "open" ? { gt: now } : { lte: now },
    },
    orderBy: { closeAt: scope === "open" ? "asc" : "desc" },
    select: {
      id: true,
      name: true,
      pickupDate: true,
      supplyPrice: true,
      inventoryItemId: true,
      closeAt: true,
      stockFixed: true,
      minPerStore: true,
      description: true,
      components: {
        orderBy: { sortOrder: "asc" },
        select: { name: true, qtyPerUnit: true, inventoryItemId: true },
      },
    },
  });
  if (products.length === 0) return [];

  const ids = products.map((p) => p.id);
  const [mine, availMap] = await Promise.all([
    prisma.reservationOrderItem.findMany({
      where: { productId: { in: ids }, order: { userId } },
      select: { productId: true, qty: true, confirmedAt: true, order: { select: { confirmed: true } } },
    }),
    availableForReservationProducts(
      products.map((p) => ({
        id: p.id,
        inventoryItemId: p.inventoryItemId,
        components: p.components.map((c) => ({ inventoryItemId: c.inventoryItemId, qtyPerUnit: c.qtyPerUnit })),
      })),
    ),
  ]);
  const myMap = new Map(mine.map((i) => [i.productId, i]));

  const rows = products.map((p) => {
    const m = myMap.get(p.id);
    const myQty = m?.qty ?? 0;
    const myConfirmed = !!m && (!!m.confirmedAt || m.order.confirmed);
    const isSet = p.components.length > 0;
    const hasLinked = !!p.inventoryItemId || p.components.some((c) => c.inventoryItemId);
    return {
      id: p.id,
      name: p.name,
      pickupDate: p.pickupDate,
      supplyPrice: p.supplyPrice,
      inventoryItemId: p.inventoryItemId,
      closeAtMs: (p.closeAt as Date).getTime(),
      minPerStore: p.minPerStore,
      description: p.description,
      myQty,
      myConfirmed,
      myConfirmedQty: myConfirmed ? myQty : 0,
      stockFixed: p.stockFixed,
      // 재고연동(단일·세트): 표시용 남은수량 = 전체가용 + 내가 이미 담은 만큼(내 수량은 내가 줄일 수 있으니 더함)
      available: hasLinked ? (availMap[p.id] ?? 0) + myQty : 0,
      components: p.components.map((c) => ({ name: c.name, qtyPerUnit: c.qtyPerUnit })),
      isSet,
      hasLinked,
    };
  });
  // 정렬: ①마감 임박순(closeAtMs) ②같은 마감시각이면 ㄱㄴㄷ(이름). JS localeCompare로 한글 순서 보장.
  rows.sort((a, b) => {
    if (a.closeAtMs !== b.closeAtMs) {
      return scope === "open" ? a.closeAtMs - b.closeAtMs : b.closeAtMs - a.closeAtMs;
    }
    return a.name.localeCompare(b.name, "ko");
  });
  return rows;
}

// ── 마감 묶음 — 점주·관리자 목록 공용 ────────────────────────
// 순수 함수라 클라이언트 부품도 쓰도록 src/lib/flat-group.ts 한 곳에 둔다(같은 계산 두 벌 금지). 서버 쪽 입구만 남김.
export { groupFlatByClose, type FlatCloseGroup, type FlatShipGroup } from "@/lib/flat-group";

// ── 점주 '내 발주 · 출고 예정' ─────────────────────────────
// 출고일이 오늘(KST) 이후(오늘 포함)인 내 확정 줄. 확정 조건은 출고·계산서(reservation-data.ts)와 똑같이
// qty>0 · 묶음 활성 · (order.confirmed OR item.confirmedAt) → 화면 숫자 = 계산서 숫자.
// 마감 지난 상품·삭제(숨김)된 상품의 줄도 그대로 나간다(출고·계산서가 상품 숨김을 보지 않으므로 같이 보여 준다).
export type FlatMyOrderRow = {
  productId: string;
  name: string; // 줄 스냅샷(계산서에 실리는 이름)
  qty: number; // 세트면 세트 수
  supplyPrice: number; // 줄 스냅샷 공급가(세트는 등록 때의 구성품 합)
  pickupDate: string; // 출고일
  closeAtMs: number | null; // 상품 마감(옛 날짜형 상품이면 null)
  isSet: boolean;
};
export async function listMyFlatOrders(userId: string, now: Date = new Date()): Promise<FlatMyOrderRow[]> {
  const today = kstTodayStr(now);
  const items = await prisma.reservationOrderItem.findMany({
    where: {
      pickupDate: { gte: today },
      qty: { gt: 0 },
      order: { userId, batch: { active: true } },
      OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
    },
    select: { productId: true, name: true, qty: true, supplyPrice: true, pickupDate: true },
  });
  if (items.length === 0) return [];
  const products = await prisma.reservationProduct.findMany({
    where: { id: { in: [...new Set(items.map((i) => i.productId))] } },
    select: { id: true, closeAt: true, _count: { select: { components: true } } },
  });
  const pmap = new Map(products.map((p) => [p.id, p]));
  const rows = items.map((it) => {
    const p = pmap.get(it.productId);
    return {
      productId: it.productId,
      name: it.name,
      qty: it.qty,
      supplyPrice: it.supplyPrice,
      pickupDate: it.pickupDate,
      closeAtMs: p?.closeAt ? p.closeAt.getTime() : null,
      isSet: (p?._count.components ?? 0) > 0,
    };
  });
  // 출고일 빠른 순 → ㄱㄴㄷ
  rows.sort((a, b) => a.pickupDate.localeCompare(b.pickupDate) || a.name.localeCompare(b.name, "ko"));
  return rows;
}

// scope 전체 집계 — 각 상품에 '들어온 지점만'(확정분) 수량을 묶는다. '전체 집계' 페이지용.
export type FlatAggProduct = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  total: number; // 이 상품 전 지점 합
  stores: { storeName: string; qty: number }[]; // 발주한 지점만(qty>0), ㄱㄴㄷ
};
export async function flatScopeAggregate(
  scope: FlatScope,
  now: Date = new Date(),
): Promise<{ products: FlatAggProduct[]; grandTotal: number; storeCount: number }> {
  const products = await prisma.reservationProduct.findMany({
    where: flatScopeWhere(scope, now),
    orderBy: { closeAt: scope === "open" ? "asc" : "desc" },
    select: { id: true, name: true, pickupDate: true, supplyPrice: true, closeAt: true },
  });
  if (products.length === 0) return { products: [], grandTotal: 0, storeCount: 0 };

  const ids = products.map((p) => p.id);
  const items = await prisma.reservationOrderItem.findMany({
    where: {
      productId: { in: ids },
      qty: { gt: 0 },
      order: { batch: { active: true } },
      OR: [{ confirmedAt: { not: null } }, { order: { confirmed: true } }], // 확정분만(집계 = 실제 발주될 수량)
    },
    select: {
      productId: true,
      qty: true,
      order: { select: { userId: true, user: { select: { storeName: true } } } },
    },
  });

  // 상품 → (점포 → 수량). 점포당 상품 1행이지만 안전하게 합산.
  const byProduct = new Map<string, Map<string, { storeName: string; qty: number }>>();
  const allStores = new Set<string>();
  for (const it of items) {
    let sm = byProduct.get(it.productId);
    if (!sm) {
      sm = new Map();
      byProduct.set(it.productId, sm);
    }
    const cur = sm.get(it.order.userId) ?? { storeName: it.order.user.storeName, qty: 0 };
    cur.qty += it.qty;
    sm.set(it.order.userId, cur);
    allStores.add(it.order.userId);
  }

  let grandTotal = 0;
  const out: FlatAggProduct[] = products.map((p) => {
    const sm = byProduct.get(p.id);
    const stores = sm
      ? [...sm.values()].sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"))
      : [];
    const total = stores.reduce((s, r) => s + r.qty, 0);
    grandTotal += total;
    return { id: p.id, name: p.name, pickupDate: p.pickupDate, supplyPrice: p.supplyPrice, total, stores };
  });
  // 발주가 하나도 없는 상품은 집계에서 제외(들어온 것만 정리).
  return { products: out.filter((p) => p.total > 0), grandTotal, storeCount: allStores.size };
}

// 관리자 상품 상세 — 이 상품을 발주한 점포별 수량(수정용).
export type FlatStoreRow = {
  userId: string;
  storeName: string;
  itemId: string;
  qty: number; // 확정 수량(집계와 일치). 미확정 홀드는 0으로 두고 heldUnconfirmed 로 표시.
  inventoryItemId: string;
  stockDeducted: boolean;
  heldUnconfirmed: boolean; // 점주가 고르는 중(확정 전) — 마감 전엔 본사가 덮어쓰지 않고, 마감 뒤엔 덮어쓸 수 있다
  heldQty: number; // 미확정 줄의 수량(heldUnconfirmed 일 때만 > 0) — 출고·계산서로는 안 나감
  belowRule: boolean; // 확정 수량이 지금 최소 수량보다 적음 → '미달' 표시(막지는 않음)
  statusLabel: string; // 승인 안 된 지점(정지 등)이면 상태 이름 — 줄이 남아 있어 보이지만 0으로만 고칠 수 있다. 정상이면 ""
};
export async function flatProductStores(
  productId: string,
  now: Date = new Date(),
): Promise<{
  product: {
    id: string;
    name: string;
    pickupDate: string; // 출고일
    supplyPrice: number;
    inventoryItemId: string;
    closeAtMs: number;
    closed: boolean; // 발주 마감 지남 → 점주는 못 고침, 미확정 줄도 본사가 덮어쓸 수 있음
    pickupPassed: boolean; // 출고일까지 지남(=지난 출고 마감) → 편집 불가
    stockFixed: boolean; // 재고 고정(초과발주 금지)
    minPerStore: number | null;
    description: string;
  } | null;
  stores: FlatStoreRow[];
}> {
  const product = await prisma.reservationProduct.findFirst({
    where: { id: productId, closeAt: { not: null } },
    select: {
      id: true,
      name: true,
      pickupDate: true,
      supplyPrice: true,
      inventoryItemId: true,
      closeAt: true,
      stockFixed: true,
      minPerStore: true,
      description: true,
    },
  });
  if (!product) return { product: null, stores: [] };
  const rule = { minPerStore: product.minPerStore };

  // 발주를 안 넣은 지점도 관리자가 수량을 추가할 수 있게 — 전 가맹점(핫딜마켓·승인)을 모두 노출.
  // 발주 없는 지점은 qty 0으로 뜨고, 여기서 수량을 넣으면 그 점주에게도 예약이 생긴다.
  const items = await prisma.reservationOrderItem.findMany({
    // 확정/미확정 모두 읽는다(unique orderId_productId 로 점포당 1행). 표시 수량은 확정분만,
    // 미확정 홀드(점주가 담는 중)는 heldUnconfirmed 로 구분해 본사가 덮어쓰지 않도록 한다.
    where: { productId, qty: { gt: 0 }, order: { batch: { active: true } } },
    select: {
      qty: true,
      confirmedAt: true,
      stockDeductedAt: true,
      order: { select: { userId: true, confirmed: true } },
    },
  });
  // 줄이 남은 지점은 승인 상태와 상관없이 함께 — 정지된 지점의 확정 줄도 출고·계산서로 나가고 상품 삭제를 막으므로
  //  여기서 0으로 고칠 수 있어야 한다.
  const merchants = await prisma.user.findMany({
    where: {
      role: "MERCHANT_HOTDEAL",
      OR: [{ status: "APPROVED" }, { id: { in: items.map((it) => it.order.userId) } }],
    },
    orderBy: { storeName: "asc" },
    select: { id: true, storeName: true, status: true },
  });
  const byUser = new Map(items.map((it) => [it.order.userId, it]));
  const stores: FlatStoreRow[] = merchants.map((m) => {
    const it = byUser.get(m.id);
    const confirmed = !!it && (!!it.confirmedAt || it.order.confirmed); // 출고·계산서와 같은 확정 조건
    const qty = confirmed ? (it?.qty ?? 0) : 0; // 확정분만 노출(집계와 일치)
    const held = !!it && !confirmed && it.qty > 0;
    return {
      userId: m.id,
      storeName: m.storeName,
      itemId: "", // 편집은 (productId,userId)로 식별 — 신규 생성/삭제 모두 처리
      qty,
      inventoryItemId: product.inventoryItemId, // 신규 생성 시 상품의 연동 재고를 상속
      stockDeducted: !!it?.stockDeductedAt,
      heldUnconfirmed: held,
      heldQty: held ? (it?.qty ?? 0) : 0,
      belowRule: qty > 0 && flatQtyProblem(qty, 0, rule) !== null,
      statusLabel: m.status === "APPROVED" ? "" : (STATUS_LABEL[m.status as Status] ?? m.status),
    };
  });
  const closeAtMs = (product.closeAt as Date).getTime();
  return {
    product: {
      id: product.id,
      name: product.name,
      pickupDate: product.pickupDate,
      supplyPrice: product.supplyPrice,
      inventoryItemId: product.inventoryItemId,
      closeAtMs,
      closed: now.getTime() >= closeAtMs,
      pickupPassed: product.pickupDate < kstTodayStr(now),
      stockFixed: product.stockFixed,
      minPerStore: product.minPerStore,
      description: product.description,
    },
    stores,
  };
}

// 마감된 flat 재고연동 상품의 '미확정' 홀드를 해제(삭제).
// 재고연동 담기는 즉시 재고를 홀드(stockDeductedAt:null 로 가용에서 빠짐)하는데,
// 발주 확정을 안 한 채 상품이 마감되면 그 홀드가 계산서로 차감되지도 해제되지도 않아
// 같은 재고품목의 다른 발주·재고현황 가용을 영구히 갉아먹는다 → 마감 후 정리.
export async function releaseClosedFlatHolds(now: Date = new Date()): Promise<number> {
  // 연동 단일 + 세트(연동 구성품 보유) 둘 다 — 마감됐는데 미확정이면 홀드가 재고를 영구 점유하므로 해제.
  const closed = await prisma.reservationProduct.findMany({
    where: {
      closeAt: { not: null, lte: now },
      OR: [{ inventoryItemId: { not: "" } }, { components: { some: { inventoryItemId: { not: "" } } } }],
    },
    select: { id: true },
  });
  if (closed.length === 0) return 0;
  const ids = closed.map((p) => p.id);
  const res = await prisma.reservationOrderItem.deleteMany({
    where: {
      productId: { in: ids },
      confirmedAt: null, // 확정분은 계산서로 차감되므로 건드리지 않음
      order: { confirmed: false }, // 옛 주문 확정(order.confirmed)도 출고·계산서에선 확정이라 건드리지 않음
      qty: { gt: 0 },
      stockDeductedAt: null,
    },
  });
  return res.count;
}

// 남은 시간 라벨 "N시간 M분 S초 남음" / "마감됐어요". 서버 SSR 시드용(클라가 1초 갱신).
export function closeRemainLabel(closeAt: Date, now: number = Date.now()): string {
  let s = Math.floor((closeAt.getTime() - now) / 1000);
  if (s <= 0) return "마감됐어요";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d}일 ${h}시간 남음`;
  return `${h}시간 ${m}분 ${s}초 남음`;
}
