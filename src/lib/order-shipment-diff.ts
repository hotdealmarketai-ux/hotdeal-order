import { prisma } from "@/lib/prisma";
import { qtyNum } from "@/lib/qty";
import { buildStoreReceipt, getVendorStoreList } from "@/lib/vendor-receipt";
import { requireAdmin } from "@/lib/session";

// 발주↔출고 대조 (읽기 전용, 재고 무차감) — '그 출고일 본사출고 발주(공구·채움채·주간)'와
// '그 출고일 발행된 계산서'를 품목명 기준으로 대조해 수량이 어긋난(=재고가 튄) 품목만 골라낸다.
//  · 발주 측 = lib/vendor-receipt.ts buildStoreReceipt(공구 toolLines + 채움채 tofuLines + 주간 weekly)
//  · 출고 측 = 그 출고일(date) 발행(ISSUED/PAID) DAILY+WEEKLY 계산서의 품목(category TOOL/TOFU/WEEKLY)
//  · 대조 = 카테고리별로 이름(trim) 합산 후 (발주수량 − 계산서수량). 0이 아닌 행만 반환.
//    diff>0 = 발주했는데 계산서에 덜/안 잡힘(출고 안 됨), diff<0 = 계산서에만 더 잡힘.
// 재고 차감/조정은 절대 하지 않는다 — 눈으로 확인해 ERP 입력 시 재고 튐만 찾는 용도.

export type DiffRow = { name: string; ordered: number; invoiced: number; diff: number };
export type CatKey = "tool" | "tofu" | "weekly";
export type CatDiff = { tool: DiffRow[]; tofu: DiffRow[]; weekly: DiffRow[] };
export type StoreDiff = {
  userId: string;
  storeName: string;
  tool: DiffRow[];
  tofu: DiffRow[];
  weekly: DiffRow[];
  mismatchCount: number;
};
export type OrderShipmentDiff = {
  date: string;
  total: CatDiff;
  byStore: StoreDiff[]; // 어긋난 품목이 있는 지점만
  storeCount: number; // 발주 또는 계산서가 있는 전체 지점 수
  mismatchStoreCount: number; // 어긋난 지점 수
  totalMismatch: number; // 총합 뷰의 어긋난 품목 수(카테고리 합)
};

const round = (n: number) => Math.round(n * 1000) / 1000;

function addTo(m: Map<string, number>, name: string, qty: number) {
  const n = (name ?? "").trim();
  if (!n || !(qty > 0)) return;
  m.set(n, (m.get(n) ?? 0) + qty);
}
function mergeInto(dst: Map<string, number>, src: Map<string, number>) {
  for (const [k, v] of src) dst.set(k, (dst.get(k) ?? 0) + v);
}

// 두 Map(발주/계산서)을 대조 → diff!=0 인 행만(이름 정렬).
function diffRows(ordered: Map<string, number>, invoiced: Map<string, number>): DiffRow[] {
  const names = new Set([...ordered.keys(), ...invoiced.keys()]);
  const rows: DiffRow[] = [];
  for (const name of names) {
    const o = round(ordered.get(name) ?? 0);
    const i = round(invoiced.get(name) ?? 0);
    if (o !== i) rows.push({ name, ordered: o, invoiced: i, diff: round(o - i) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}

export async function computeOrderShipmentDiff(date: string): Promise<OrderShipmentDiff> {
  await requireAdmin();

  // ── 출고(계산서) 측: 그 출고일 발행 DAILY+WEEKLY 계산서 품목을 지점×카테고리×이름 합산 ──
  const invoices = await prisma.invoice.findMany({
    where: { date, kind: { in: ["DAILY", "WEEKLY"] }, status: { in: ["ISSUED", "PAID"] } },
    select: { userId: true, items: { select: { category: true, name: true, qty: true } } },
  });
  type CatMaps = { tool: Map<string, number>; tofu: Map<string, number>; weekly: Map<string, number> };
  const invByStore = new Map<string, CatMaps>();
  const ensureInv = (uid: string): CatMaps => {
    let e = invByStore.get(uid);
    if (!e) {
      e = { tool: new Map(), tofu: new Map(), weekly: new Map() };
      invByStore.set(uid, e);
    }
    return e;
  };
  for (const inv of invoices) {
    const e = ensureInv(inv.userId);
    for (const it of inv.items) {
      if (it.category === "TOOL") addTo(e.tool, it.name, it.qty);
      else if (it.category === "TOFU") addTo(e.tofu, it.name, it.qty);
      else if (it.category === "WEEKLY") addTo(e.weekly, it.name, it.qty);
    }
  }

  // ── 대상 지점 = 발주 있는 지점 ∪ 계산서 있는 지점(계산서에만 있는 지점도 잡아야 튐이 보임) ──
  const orderStores = await getVendorStoreList(date);
  const nameMap = new Map(orderStores.map((s) => [s.userId, s.storeName]));
  const missing = [...invByStore.keys()].filter((id) => !nameMap.has(id));
  if (missing.length) {
    const us = await prisma.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, storeName: true },
    });
    for (const u of us) nameMap.set(u.id, u.storeName);
  }
  const allIds = [...nameMap.keys()];

  // ── 지점별 대조 + 총합 누적 ──
  const T: CatMaps & { iTool: Map<string, number>; iTofu: Map<string, number>; iWeekly: Map<string, number> } = {
    tool: new Map(),
    tofu: new Map(),
    weekly: new Map(),
    iTool: new Map(),
    iTofu: new Map(),
    iWeekly: new Map(),
  };
  const byStore: StoreDiff[] = [];

  for (const userId of allIds) {
    const receipt = await buildStoreReceipt(userId, date);
    const ordTool = new Map<string, number>();
    for (const l of receipt.toolLines) addTo(ordTool, l.name, qtyNum(l.qty));
    const ordTofu = new Map<string, number>();
    for (const l of receipt.tofuLines) addTo(ordTofu, l.name, qtyNum(l.qty));
    const ordWeekly = new Map<string, number>();
    for (const w of receipt.weekly) addTo(ordWeekly, w.name, w.qty);

    const inv = invByStore.get(userId) ?? { tool: new Map(), tofu: new Map(), weekly: new Map() };

    // 총합 누적(발주/계산서 각각)
    mergeInto(T.tool, ordTool);
    mergeInto(T.tofu, ordTofu);
    mergeInto(T.weekly, ordWeekly);
    mergeInto(T.iTool, inv.tool);
    mergeInto(T.iTofu, inv.tofu);
    mergeInto(T.iWeekly, inv.weekly);

    const tool = diffRows(ordTool, inv.tool);
    const tofu = diffRows(ordTofu, inv.tofu);
    const weekly = diffRows(ordWeekly, inv.weekly);
    const mismatchCount = tool.length + tofu.length + weekly.length;
    if (mismatchCount > 0) {
      byStore.push({
        userId,
        storeName: nameMap.get(userId) ?? userId,
        tool,
        tofu,
        weekly,
        mismatchCount,
      });
    }
  }

  byStore.sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));

  const total: CatDiff = {
    tool: diffRows(T.tool, T.iTool),
    tofu: diffRows(T.tofu, T.iTofu),
    weekly: diffRows(T.weekly, T.iWeekly),
  };
  const totalMismatch = total.tool.length + total.tofu.length + total.weekly.length;

  return {
    date,
    total,
    byStore,
    storeCount: allIds.length,
    mismatchStoreCount: byStore.length,
    totalMismatch,
  };
}
