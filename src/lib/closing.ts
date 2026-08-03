// 마감(일일 백업) — 전체 핵심 데이터를 xlsx 워크북으로 만든다(파일은 관리자가 다운로드, DB엔 요약 로그만).
// 시트: 요약 / 미수 / 출고 계산서 / 재고현황. 데이터 유실 대비용 스냅샷.
import ExcelJS from "exceljs";
import { prisma } from "@/lib/prisma";
import { CATEGORIES } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { logError } from "@/lib/log";

const catLabel = (c: string) =>
  (CATEGORIES as Record<string, { label: string }>)[c]?.label ??
  ((({ WEEKLY: "주간발주", DELIVERY: "용달 발송" }) as Record<string, string>)[
    c
  ] ??
    c);

export type ClosingSummary = {
  closedAtLabel: string;
  storeCount: number;
  receivableTotal: number;
  invoiceCount: number;
  invoiceItemCount: number;
  inventoryCount: number;
  perStore: { store: string; balance: number }[];
};

export async function buildClosingWorkbook(
  now: Date,
): Promise<{ buffer: Buffer; summary: ClosingSummary }> {
  const [stores, arGroups, adjGroups, invoices, inventory] = await Promise.all([
    prisma.user.findMany({
      where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
      orderBy: { storeName: "asc" },
      select: { id: true, storeName: true },
    }),
    // 미수 = 발행·미입금(ISSUED) 계산서 합 (receivableOf와 동일 정의). 종류 무관.
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { status: "ISSUED" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.receivableAdjustment.groupBy({
      by: ["userId"],
      _sum: { amount: true },
    }),
    // 출고된 발주 = 발행/입금완료(ISSUED·PAID) 계산서 품목(초안·취소 제외) — 완전한 출고 기록.
    prisma.invoice.findMany({
      where: { status: { in: ["ISSUED", "PAID"] } },
      orderBy: [{ date: "asc" }],
      select: {
        date: true,
        kind: true,
        status: true,
        user: { select: { storeName: true } },
        items: {
          orderBy: { sortOrder: "asc" },
          select: {
            category: true,
            name: true,
            qty: true,
            unitPrice: true,
            amount: true,
          },
        },
      },
    }),
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        name: true,
        qty: true,
        supplyPrice: true,
        majorCat: true,
        minorCat: true,
        expiry: true,
      },
    }),
  ]);

  const arByUser = new Map(
    arGroups.map((g) => [g.userId, { sum: g._sum.total ?? 0, count: g._count }]),
  );
  const adjByUser = new Map(adjGroups.map((g) => [g.userId, g._sum.amount ?? 0]));
  // 미수 대상 = 승인된 핫딜 점포 ∪ (정지·역할변경됐어도) 미수/조정이 남은 모든 유저.
  // 백업이므로 상태와 무관하게 미수를 하나도 빠뜨리지 않는다(발행됐는데 정지된 점포의 미수까지 포함).
  const nameById = new Map(stores.map((s) => [s.id, s.storeName]));
  const arUserIds = new Set<string>([...arByUser.keys(), ...adjByUser.keys()]);
  const missing = [...arUserIds].filter((id) => !nameById.has(id));
  if (missing.length > 0) {
    const more = await prisma.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, storeName: true },
    });
    for (const u of more) nameById.set(u.id, u.storeName);
  }
  const allUserIds = [
    ...new Set<string>([...stores.map((s) => s.id), ...arUserIds]),
  ];
  const perStore = allUserIds
    .map((id) => ({
      store: nameById.get(id) ?? id,
      balance: (arByUser.get(id)?.sum ?? 0) + (adjByUser.get(id) ?? 0),
      count: arByUser.get(id)?.count ?? 0,
    }))
    .sort(
      (a, b) => b.balance - a.balance || a.store.localeCompare(b.store, "ko"),
    );
  const receivableTotal = perStore.reduce((n, r) => n + r.balance, 0);
  const invoiceItemCount = invoices.reduce((n, inv) => n + inv.items.length, 0);
  const closedAtLabel = formatKDateTime(now);

  const wb = new ExcelJS.Workbook();
  wb.creator = "오더야";
  wb.created = now;

  // ── 요약 ──
  const wsSum = wb.addWorksheet("요약");
  wsSum.columns = [
    { header: "항목", key: "k", width: 24 },
    { header: "값", key: "v", width: 28, style: { numFmt: "#,##0" } },
  ];
  wsSum.addRow({ k: "마감 시각", v: closedAtLabel });
  wsSum.addRow({ k: "가맹점 수", v: stores.length });
  wsSum.addRow({ k: "전체 미수 합계(원)", v: receivableTotal });
  wsSum.addRow({ k: "백업 계산서 수", v: invoices.length });
  wsSum.addRow({ k: "백업 출고 품목 행 수", v: invoiceItemCount });
  wsSum.addRow({ k: "재고 품목 수", v: inventory.length });

  // ── 미수 ──
  const wsAr = wb.addWorksheet("미수");
  wsAr.columns = [
    { header: "가맹점", key: "store", width: 24 },
    { header: "미수금액", key: "balance", width: 18, style: { numFmt: "#,##0" } },
  ];
  for (const r of perStore) wsAr.addRow({ store: r.store, balance: r.balance });
  const arTotal = wsAr.addRow({ store: "합계", balance: receivableTotal });
  arTotal.font = { bold: true };

  // ── 출고 계산서 — 지점별 탭. 각 탭: 품목 + 카테고리별 총 금액 + 지점 전체 총 금액. ──
  const invByStore = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const arr = invByStore.get(inv.user.storeName);
    if (arr) arr.push(inv);
    else invByStore.set(inv.user.storeName, [inv]);
  }
  const CAT_RANK: Record<string, number> = {
    FRUIT: 0,
    VEG: 1,
    TOOL: 2,
    TOFU: 3,
    DELIVERY: 4,
    WEEKLY: 5,
  };
  // 시트명 규칙(엑셀): 31자 · [ ] * ? / \ : 금지 · 앞뒤 작은따옴표 금지 · "History" 예약 · 중복(대소문자 무시) 금지.
  // exceljs는 중복을 대소문자 무시로 판정하므로(예: "Cafe"/"cafe") 소문자 키로 중복을 막는다.
  const usedLower = new Set<string>(["요약", "미수", "재고현황"]);
  const sheetName = (raw: string) => {
    let base =
      raw
        .replace(/[[\]*?\/\\:]/g, " ")
        .trim()
        .slice(0, 27)
        .replace(/^'+|'+$/g, "")
        .trim();
    if (!base || base.toLowerCase() === "history") base = "점포";
    let n = base;
    let i = 2;
    while (usedLower.has(n.toLowerCase())) n = `${base.slice(0, 24)} ${i++}`;
    usedLower.add(n.toLowerCase());
    return n;
  };
  const storeSheets: ExcelJS.Worksheet[] = [];
  for (const [store, invs] of invByStore) {
    const ws = wb.addWorksheet(sheetName(store));
    ws.columns = [
      { header: "출고일", key: "date", width: 12 },
      { header: "종류", key: "kind", width: 8 },
      { header: "상태", key: "status", width: 10 },
      { header: "분류", key: "cat", width: 12 },
      { header: "품목", key: "name", width: 26 },
      { header: "수량", key: "qty", width: 8 },
      { header: "단가", key: "unitPrice", width: 12, style: { numFmt: "#,##0" } },
      { header: "금액", key: "amount", width: 14, style: { numFmt: "#,##0" } },
    ];
    const catTotal = new Map<string, number>();
    let grand = 0;
    for (const inv of invs)
      for (const it of inv.items) {
        ws.addRow({
          date: inv.date,
          kind: inv.kind === "WEEKLY" ? "주간" : "일반",
          status: inv.status === "PAID" ? "입금완료" : "입금대기",
          cat: catLabel(it.category),
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
          amount: it.amount,
        });
        catTotal.set(it.category, (catTotal.get(it.category) ?? 0) + it.amount);
        grand += it.amount;
      }
    ws.addRow({}); // 빈 줄
    const cats = [...catTotal.keys()].sort(
      (a, b) => (CAT_RANK[a] ?? 9) - (CAT_RANK[b] ?? 9),
    );
    for (const c of cats) {
      const r = ws.addRow({
        name: `${catLabel(c)} 총 금액`,
        amount: catTotal.get(c),
      });
      r.font = { bold: true };
    }
    const g = ws.addRow({ name: "계산서 전체 총 금액", amount: grand });
    g.font = { bold: true };
    storeSheets.push(ws);
  }

  // ── 재고현황 ──
  const wsStock = wb.addWorksheet("재고현황");
  wsStock.columns = [
    { header: "품목", key: "name", width: 26 },
    { header: "수량", key: "qty", width: 8 },
    { header: "공급가", key: "supplyPrice", width: 12, style: { numFmt: "#,##0" } },
    { header: "대분류", key: "majorCat", width: 14 },
    { header: "중분류", key: "minorCat", width: 14 },
    { header: "유통기한", key: "expiry", width: 12 },
  ];
  for (const it of inventory)
    wsStock.addRow({
      name: it.name,
      qty: it.qty,
      supplyPrice: it.supplyPrice,
      majorCat: it.majorCat,
      minorCat: it.minorCat,
      expiry: it.expiry,
    });

  for (const ws of [wsSum, wsAr, ...storeSheets, wsStock]) {
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }

  const arr = await wb.xlsx.writeBuffer();
  const buffer = Buffer.from(arr as ArrayBuffer);
  return {
    buffer,
    summary: {
      closedAtLabel,
      storeCount: perStore.length,
      receivableTotal,
      invoiceCount: invoices.length,
      invoiceItemCount,
      inventoryCount: inventory.length,
      perStore: perStore.map((r) => ({ store: r.store, balance: r.balance })),
    },
  };
}

// 마감 로그 — 다운로드 순간의 요약만 기록(파일·대량 데이터는 저장하지 않음). 실패해도 다운로드는 막지 않는다.
export async function writeClosingLog(
  actor: { id: string; storeName: string },
  summary: ClosingSummary,
): Promise<void> {
  try {
    await prisma.closingLog.create({
      data: {
        actorId: actor.id,
        actorName: actor.storeName,
        storeCount: summary.storeCount,
        receivableTotal: summary.receivableTotal,
        invoiceCount: summary.invoiceCount,
        invoiceItemCount: summary.invoiceItemCount,
        inventoryCount: summary.inventoryCount,
        snapshot: JSON.stringify(summary.perStore.slice(0, 200)).slice(0, 8000),
      },
    });
  } catch (e) {
    logError("closing.writeLog", e, { actorId: actor.id });
  }
}
