// 계산서(일일) 발행 기준 재고 차감 — 계산서 = 실제 출고 기준. 발주 마감(8시) 자동차감을 대체하는 유일 소스.
// 발행 시 그 계산서의 공구(TOOL) 품목 수량만큼 기준재고(base)를 차감하고, 취소/수정 시 복구/재조정한다.
import { prisma } from "@/lib/prisma";
import { setInventoryPushPending } from "@/lib/inventory-sheet";
import { Prisma } from "@prisma/client";

// 그 계산서의 공구(TOOL) 품목을 품목명별 수량으로 합산(정수 반올림 — 기준재고가 Int).
export async function invoiceToolByName(invoiceId: string): Promise<Map<string, number>> {
  const items = await prisma.invoiceItem.findMany({
    where: { invoiceId, category: "TOOL" },
    select: { name: true, qty: true },
  });
  const m = new Map<string, number>();
  for (const it of items) {
    const name = it.name.trim();
    const q = Math.round(it.qty);
    if (name && q > 0) m.set(name, (m.get(name) ?? 0) + q);
  }
  return m;
}

// 계산서 발행 시 재고 차감(멱등). DAILY·미차감(stockDeductedAt=null)만.
export async function deductInvoiceStock(
  invoiceId: string,
  now: number = Date.now(),
): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, userId: true, date: true, kind: true, stockDeductedAt: true },
  });
  if (!inv || inv.kind !== "DAILY" || inv.stockDeductedAt) return false;
  const byName = await invoiceToolByName(invoiceId);
  const at = new Date(now);
  await prisma.$transaction([
    // GREATEST(0, …): 실물보다 많이 나가도 음수 저장 방지(차이는 수기 보정).
    ...[...byName.entries()].map(
      ([name, q]) =>
        prisma.$executeRaw`UPDATE "InventoryItem" SET qty = GREATEST(0, qty - ${q}) WHERE name = ${name} AND "deletedAt" IS NULL`,
    ),
    // 멱등 마커 — null일 때만 세팅(동시 발행 레이스에서 한 번만 차감).
    prisma.invoice.updateMany({
      where: { id: inv.id, stockDeductedAt: null },
      data: { stockDeductedAt: at },
    }),
    // 이 출고일에 픽업하는 이 점포의 예약(재고연동) 확정분을 '차감됨'으로 표시 — 계산서에 함께 불러와 차감되므로,
    // 판매가능(reservationHeldByItem)에서 이중으로 잡히지 않게(base 차감 시점과 정합).
    prisma.reservationOrderItem.updateMany({
      where: {
        pickupDate: inv.date,
        inventoryItemId: { not: "" },
        stockDeductedAt: null,
        order: { userId: inv.userId, batch: { active: true } }, OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
      },
      data: { stockDeductedAt: at },
    }),
  ]);
  await setInventoryPushPending().catch(() => {});
  return true;
}

// 계산서 수정(재발행) 시 재고 재조정 — 수정 전 공구 품목(oldByName) 대비 현재 품목의 '차이만큼만' base 조정(원자적).
// delta = 현재 − 이전. base −= delta (GREATEST 0). 이미 차감 상태이므로 stockDeductedAt은 그대로 유지.
export async function applyInvoiceStockDelta(
  invoiceId: string,
  oldByName: Map<string, number>,
): Promise<void> {
  const newByName = await invoiceToolByName(invoiceId);
  const names = new Set<string>([...oldByName.keys(), ...newByName.keys()]);
  const stmts = [] as Prisma.PrismaPromise<number>[];
  for (const name of names) {
    const delta = (newByName.get(name) ?? 0) - (oldByName.get(name) ?? 0);
    if (delta === 0) continue;
    stmts.push(
      prisma.$executeRaw`UPDATE "InventoryItem" SET qty = GREATEST(0, qty - ${delta}) WHERE name = ${name} AND "deletedAt" IS NULL`,
    );
  }
  if (stmts.length > 0) {
    await prisma.$transaction(stmts);
    await setInventoryPushPending().catch(() => {});
  }
}

// 계산서 취소/수정 시 재고 복구(멱등). 차감돼있던(stockDeductedAt≠null) 계산서만.
// keepReservations=true: 수정(곧 재차감) 시엔 예약 차감표시를 그대로 둔다(취소 때만 되돌림).
export async function restoreInvoiceStock(
  invoiceId: string,
  opts?: { keepReservations?: boolean },
): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, userId: true, date: true, stockDeductedAt: true },
  });
  if (!inv || !inv.stockDeductedAt) return false;
  const byName = await invoiceToolByName(invoiceId);
  await prisma.$transaction([
    ...[...byName.entries()].map(
      ([name, q]) =>
        prisma.$executeRaw`UPDATE "InventoryItem" SET qty = qty + ${q} WHERE name = ${name} AND "deletedAt" IS NULL`,
    ),
    prisma.invoice.updateMany({ where: { id: inv.id }, data: { stockDeductedAt: null } }),
    // 취소 시엔 예약 차감표시도 되돌림(다시 판매가능에서 홀드로 잡히게). 수정 시엔 유지(곧 재차감).
    ...(opts?.keepReservations
      ? []
      : [
          prisma.reservationOrderItem.updateMany({
            where: {
              pickupDate: inv.date,
              inventoryItemId: { not: "" },
              stockDeductedAt: { not: null },
              order: { userId: inv.userId, batch: { active: true } }, OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
            },
            data: { stockDeductedAt: null },
          }),
        ]),
  ]);
  await setInventoryPushPending().catch(() => {});
  return true;
}
