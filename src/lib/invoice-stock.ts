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

// 실제 차감 스냅샷 파서(JSON {InventoryItem.id: 실제차감량}). 빈값/손상=null(→ 청구량으로 폴백).
// ⚠ id 키다(이름 키 아님). 동명 중복행이 있어도 각 행을 정확히 되돌리려면 id로 기록해야 한다.
function parseSnap(v: string): Record<string, number> | null {
  if (!v) return null;
  try {
    const j = JSON.parse(v);
    return j && typeof j === "object" ? (j as Record<string, number>) : null;
  } catch {
    return null;
  }
}

// 한 품목명을 GREATEST(0, qty−q)로 차감하면서 '행별 실제 차감량'을 id 키로 snap에 누적.
// CTE + FOR UPDATE 로 행을 잠그고 이전/이후 qty를 RETURNING → 동시 차감과도 정확.
// 동명(name 중복) 행이 여러 개면 각 행이 q만큼 차감되고 각각 id로 기록된다 → 복구도 행별로 정확.
//  (name 키로 합산하면 restore 시 그 합을 모든 동명 행에 다시 더해 재고가 뻥튀기된다 — 반드시 id 키.)
async function deductNameToSnap(
  tx: Prisma.TransactionClient,
  name: string,
  q: number,
  snap: Record<string, number>,
): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string; oldqty: number; newqty: number }[]>`
    WITH b AS (
      SELECT id, qty FROM "InventoryItem"
      WHERE name = ${name} AND "deletedAt" IS NULL
      FOR UPDATE
    )
    UPDATE "InventoryItem" i
    SET qty = GREATEST(0, i.qty - ${q})
    FROM b
    WHERE i.id = b.id
    RETURNING b.id AS id, b.qty AS oldqty, i.qty AS newqty`;
  for (const r of rows) {
    const d = Number(r.oldqty) - Number(r.newqty);
    if (d > 0) snap[r.id] = (snap[r.id] ?? 0) + d; // 실물보다 많이 나간 초과분은 안 담김(버려진 만큼 복구도 안 함)
  }
}

// 계산서 발행 시 재고 차감(멱등). DAILY·미차감(stockDeductedAt=null)만.
// 실제 차감량을 stockDeductedSnap 에 id별로 기록 → 취소/수정 때 정확히 되돌린다(초과발주 복구 뻥튀기 방지).
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
  const snap: Record<string, number> = {}; // InventoryItem.id → 실제차감량
  await prisma.$transaction(async (tx) => {
    for (const [name, q] of byName.entries()) {
      await deductNameToSnap(tx, name, q, snap);
    }
    // 멱등 마커 — null일 때만 세팅(동시 발행 레이스에서 한 번만 차감) + 실제차감 스냅샷(id 키).
    await tx.invoice.updateMany({
      where: { id: inv.id, stockDeductedAt: null },
      data: { stockDeductedAt: at, stockDeductedSnap: JSON.stringify(snap) },
    });
    // 이 출고일에 픽업하는 이 점포의 예약(재고연동) 확정분을 '차감됨'으로 표시(이중집계 방지).
    await tx.reservationOrderItem.updateMany({
      where: {
        pickupDate: inv.date,
        inventoryItemId: { not: "" },
        stockDeductedAt: null,
        order: { userId: inv.userId, batch: { active: true } },
        OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
      },
      data: { stockDeductedAt: at },
    });
  });
  await setInventoryPushPending().catch(() => {});
  return true;
}

// 계산서 수정(재발행) 시 재고 재조정 — '이전 실제차감(snap)'을 되돌리고 '새 청구분'을 다시 차감(플로어)해 정확한 역연산.
// oldByName(수정 전 공구 품목)은 snap 없는 옛 계산서 폴백용(초과발주 이전엔 실제=청구). 새 실제차감으로 snap 갱신.
// Invoice 행을 FOR UPDATE 로 잠근 뒤 그 안에서 snap을 읽는다 → 동시 재발행이 같은 stale snap을 두 번 되돌리는 이중공제를 방지.
export async function applyInvoiceStockDelta(
  invoiceId: string,
  oldByName: Map<string, number>,
): Promise<void> {
  const pre = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { stockDeductedAt: true },
  });
  if (!pre || !pre.stockDeductedAt) return; // 미차감(DRAFT 등)이면 재조정 없음
  const newByName = await invoiceToolByName(invoiceId);
  const newSnap: Record<string, number> = {}; // id → 새 실제차감량
  await prisma.$transaction(async (tx) => {
    // Invoice 행을 잠가 동시 재발행이 같은 snap을 두 번 되돌리지 못하게 직렬화(잠근 값으로만 역연산).
    const locked = await tx.$queryRaw<{ at: Date | null; snap: string }[]>`
      SELECT "stockDeductedAt" AS at, "stockDeductedSnap" AS snap
      FROM "Invoice" WHERE id = ${invoiceId} FOR UPDATE`;
    const row = locked[0];
    if (!row || !row.at) return; // 잠근 사이 취소됐으면 중단
    const oldSnap = parseSnap(row.snap);
    // 이전 실제차감 되돌림 — snap 있으면 id 키(정확), 없으면 옛 계산서 → 이름 키(청구량) 폴백.
    if (oldSnap) {
      for (const [id, back] of Object.entries(oldSnap)) {
        if (back > 0)
          await tx.$executeRaw`UPDATE "InventoryItem" SET qty = qty + ${back} WHERE id = ${id}`;
      }
    } else {
      for (const [name, back] of oldByName.entries()) {
        if (back > 0)
          await tx.$executeRaw`UPDATE "InventoryItem" SET qty = qty + ${back} WHERE name = ${name} AND "deletedAt" IS NULL`;
      }
    }
    // 새 청구분 차감(플로어) + 새 실제차감 기록(id 키).
    for (const [name, q] of newByName.entries()) {
      if (q > 0) await deductNameToSnap(tx, name, q, newSnap);
    }
    await tx.invoice.updateMany({
      where: { id: invoiceId },
      data: { stockDeductedSnap: JSON.stringify(newSnap) },
    });
  });
  await setInventoryPushPending().catch(() => {});
}

// 계산서 취소/수정 시 재고 복구(멱등). 차감돼있던(stockDeductedAt≠null) 계산서만.
// '실제 차감량(snap)'만 되돌린다(청구량 아님) → 초과발주로 버려졌던 만큼 복구가 뻥튀기되는 것 방지.
// keepReservations=true: 수정(곧 재차감) 시엔 예약 차감표시를 그대로 둔다(취소 때만 되돌림).
export async function restoreInvoiceStock(
  invoiceId: string,
  opts?: { keepReservations?: boolean },
): Promise<boolean> {
  const inv = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, userId: true, date: true, stockDeductedAt: true, stockDeductedSnap: true },
  });
  if (!inv || !inv.stockDeductedAt) return false;
  const snapById = parseSnap(inv.stockDeductedSnap);
  // snap 있으면 id 키 실제차감량으로 행별 복구(동명 중복행도 정확), 없으면(옛 계산서) 이름 키 청구량 폴백(그땐 실제=청구·단일행이라 정확).
  const restore: { byId: boolean; key: string; q: number }[] = snapById
    ? Object.entries(snapById).map(([id, q]) => ({ byId: true, key: id, q }))
    : [...(await invoiceToolByName(invoiceId)).entries()].map(([name, q]) => ({ byId: false, key: name, q }));
  await prisma.$transaction([
    ...restore
      .filter((r) => r.q > 0)
      .map((r) =>
        r.byId
          ? prisma.$executeRaw`UPDATE "InventoryItem" SET qty = qty + ${r.q} WHERE id = ${r.key}`
          : prisma.$executeRaw`UPDATE "InventoryItem" SET qty = qty + ${r.q} WHERE name = ${r.key} AND "deletedAt" IS NULL`,
      ),
    prisma.invoice.updateMany({
      where: { id: inv.id },
      data: { stockDeductedAt: null, stockDeductedSnap: "" },
    }),
    // 취소 시엔 예약 차감표시도 되돌림(다시 판매가능에서 홀드로 잡히게). 수정 시엔 유지(곧 재차감).
    ...(opts?.keepReservations
      ? []
      : [
          prisma.reservationOrderItem.updateMany({
            where: {
              pickupDate: inv.date,
              inventoryItemId: { not: "" },
              stockDeductedAt: { not: null },
              order: { userId: inv.userId, batch: { active: true } },
              OR: [{ order: { confirmed: true } }, { confirmedAt: { not: null } }],
            },
            data: { stockDeductedAt: null },
          }),
        ]),
  ]);
  await setInventoryPushPending().catch(() => {});
  return true;
}
