// ⚠ 임시 진단 라우트(관리자 게이트) — 재고 이중차감/이상 차감 감사. 확인 후 삭제.
// 발행(ISSUED/PAID) DAILY 계산서의 공구(TOOL) 품목을 (지점,출고일)별로 모아,
//   ① 같은 (지점,출고일)에 같은 품목이 2장+ 계산서에 걸쳐 차감된 것(=이중차감) 탐지
//   ② 계산서의 stockDeductedSnap(실제 차감 스냅)이 공구 라인 합과 어긋난 것(수정 이상) 탐지
//   ③ 재고현황(InventoryItem) 등록 여부(미등록=수기처리분 구분)
// 읽기 전용. base는 절대 안 건드림.
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isAdmin, type Role } from "@/lib/constants";

function parseSnap(v: string | null): Record<string, number> {
  if (!v) return {};
  try {
    const j = JSON.parse(v);
    return j && typeof j === "object" ? j : {};
  } catch {
    return {};
  }
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role as Role)) return new Response("forbidden", { status: 403 });

  const url = new URL(request.url);
  const days = Math.min(60, Math.max(1, parseInt(url.searchParams.get("days") || "14", 10) || 14));
  const KST = 9 * 3600 * 1000;
  const cut = new Date(Date.now() + KST - days * 86400000).toISOString().slice(0, 10);

  const invoices = await prisma.invoice.findMany({
    where: { kind: "DAILY", status: { in: ["ISSUED", "PAID"] }, date: { gte: cut } },
    select: {
      id: true,
      date: true,
      status: true,
      revisedAt: true,
      stockDeductedAt: true,
      stockDeductedSnap: true,
      user: { select: { storeName: true } },
      items: { where: { category: "TOOL" }, select: { name: true, qty: true } },
    },
    orderBy: { date: "desc" },
  });

  // 등록된 재고 품목명(미등록=수기처리 구분용)
  const invItems = await prisma.inventoryItem.findMany({ where: { deletedAt: null }, select: { name: true } });
  const registered = new Set(invItems.map((i) => i.name.trim()));

  // (지점|출고일|품목) → { 장수, 총차감, 계산서별 [qty], invoiceIds }
  type Cell = { store: string; date: string; name: string; perInvoice: number[]; invoiceIds: string[]; registered: boolean };
  const cells = new Map<string, Cell>();
  // 계산서별 snap↔라인 불일치
  const snapMismatch: { store: string; date: string; invoiceId: string; name: string; lineQty: number; snapQty: number }[] = [];

  for (const inv of invoices) {
    const store = inv.user?.storeName ?? "(?)";
    const snap = parseSnap(inv.stockDeductedSnap);
    // 라인 합(품목명별)
    const lineByName = new Map<string, number>();
    for (const it of inv.items) {
      const nm = it.name.trim();
      const q = Math.round(it.qty);
      if (nm && q > 0) lineByName.set(nm, (lineByName.get(nm) ?? 0) + q);
    }
    for (const [name, q] of lineByName) {
      const key = `${store}|${inv.date}|${name}`;
      const c = cells.get(key) ?? { store, date: inv.date, name, perInvoice: [], invoiceIds: [], registered: registered.has(name) };
      c.perInvoice.push(q);
      c.invoiceIds.push(inv.id);
      cells.set(key, c);
    }
    // snap 합계(이 계산서가 실제 차감한 양) — id별이라 품목명으로 되돌릴 순 없지만 총량은 비교 가능
    const snapTotal = Object.values(snap).reduce((n, v) => n + (Number(v) || 0), 0);
    const lineTotal = [...lineByName.values()].reduce((n, v) => n + v, 0);
    if (inv.stockDeductedAt && snapTotal !== lineTotal) {
      snapMismatch.push({ store, date: inv.date, invoiceId: inv.id, name: "(합계)", lineQty: lineTotal, snapQty: snapTotal });
    }
  }

  // 이중차감 = 같은 (지점,출고일,품목)이 2장+ 계산서에 걸친 것
  const doubles = [...cells.values()]
    .filter((c) => c.invoiceIds.length >= 2)
    .map((c) => ({
      store: c.store,
      date: c.date,
      item: c.name,
      registered: c.registered,
      invoiceCount: c.invoiceIds.length,
      qtyPerInvoice: c.perInvoice,
      totalDeducted: c.perInvoice.reduce((n, v) => n + v, 0),
      invoiceIds: c.invoiceIds,
    }))
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : a.store.localeCompare(b.store, "ko")));

  // (지점,출고일)에 발행 DAILY 계산서가 2장+ 인 모든 케이스 — 이중차감이 '발생 가능한' 지점.
  const byStoreDate = new Map<string, { store: string; date: string; ids: string[] }>();
  for (const inv of invoices) {
    if (inv.items.length === 0) continue; // 공구 없는 계산서는 재고 무관
    const store = inv.user?.storeName ?? "(?)";
    const k = `${store}|${inv.date}`;
    const g = byStoreDate.get(k) ?? { store, date: inv.date, ids: [] };
    g.ids.push(inv.id);
    byStoreDate.set(k, g);
  }
  const multiInvoice = [...byStoreDate.values()]
    .filter((g) => g.ids.length >= 2)
    .map((g) => ({ store: g.store, date: g.date, invoiceCount: g.ids.length, invoiceIds: g.ids }))
    .sort((a, b) => (b.date < a.date ? -1 : b.date > a.date ? 1 : a.store.localeCompare(b.store, "ko")));

  return Response.json({
    ok: true,
    days,
    since: cut,
    invoiceCount: invoices.length,
    doubleCount: doubles.length,
    doubles,             // 같은 품목이 2장+ 계산서에 걸쳐 실제 이중차감된 것
    multiInvoiceCount: multiInvoice.length,
    multiInvoice,        // 공구 있는 계산서가 2장+인 (지점,출고일) 전부 = 이중 가능 지점
    snapMismatch,        // 실제차감(snap) vs 라인 불일치(대부분 미등록/구버전=이중 아님)
  });
}
