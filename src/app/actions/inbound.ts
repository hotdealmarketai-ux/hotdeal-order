"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { normalizeExpiry } from "@/lib/date";
import { setInventoryPushPending } from "@/lib/inventory-sheet";
import { toInboundRow, type InboundRow } from "@/lib/inbound";

// 수량·공급가는 음수 없음 — 하이픈/기호 제거 후 0 바닥.
const toInt = (v: unknown) =>
  Math.max(0, parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10) || 0);

const LIST_LIMIT = 300; // 목록/검색 최대 로드(스크롤 창). 기록 자체는 무제한 보존.
const REVERT_WINDOW_MS = 60 * 60 * 1000; // 입고 후 1시간 이내면 삭제 시 재고도 되돌림.

// 입고 — 재고현황에 반영 + 입고 기록(로그) 생성.
// 재고 반영: 같은 이름 품목이 있으면 수량을 '가산'(입고=재고 추가)하고 공급가/유통기한/카테고리는
// 새로 입력한 값이 있을 때만 최신값으로 갱신. 없으면 새 품목 생성(재고현황 작성 양식과 동일 필드).
export async function createInboundAction(input: {
  name: string;
  qty: string | number;
  supplyPrice: string | number;
  expiry: string;
  majorCat: string;
  minorCat: string;
}): Promise<{ ok: boolean; row?: InboundRow; error?: string }> {
  await requireAdmin();
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "품목명을 입력해주세요." };
  const qty = toInt(input.qty);
  const supplyPrice = toInt(input.supplyPrice);
  const expiry = normalizeExpiry(String(input.expiry ?? ""));
  const majorCat = String(input.majorCat ?? "").trim().slice(0, 40);
  const minorCat = String(input.minorCat ?? "").trim().slice(0, 40);

  // 1) 재고현황 반영
  const dup = await prisma.inventoryItem.findFirst({
    where: { name, deletedAt: null },
    select: { id: true },
  });
  let itemId: string;
  if (dup) {
    await prisma.inventoryItem.update({
      where: { id: dup.id },
      data: {
        qty: { increment: qty }, // 입고 = 재고 가산
        ...(supplyPrice > 0 ? { supplyPrice } : {}), // 0(미입력)이면 기존 공급가 보존
        ...(expiry ? { expiry } : {}),
        ...(majorCat ? { majorCat } : {}),
        ...(minorCat ? { minorCat } : {}),
      },
    });
    itemId = dup.id;
  } else {
    const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.inventoryItem.create({
      data: { name, qty, supplyPrice, expiry, majorCat, minorCat, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    itemId = created.id;
  }

  // 2) 입고 기록(로그) — 입고 당시 스냅샷(영구 보존)
  const log = await prisma.inboundLog.create({
    data: { name, qty, supplyPrice, expiry, majorCat, minorCat, itemId },
  });

  await setInventoryPushPending(); // 시트 반영(단방향 push 대상 표시)
  revalidatePath("/admin/inbound");
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, row: toInboundRow(log) };
}

// 입고 기록 삭제.
// - 입고 후 1시간 이내 삭제: 방금 잘못 입력한 것으로 보고 재고현황에 더해진 수량도 함께 되돌린다(차감).
// - 1시간 이상 지난 뒤 삭제: 그동안 실재고는 재고현황에서 관리됐을 것이므로 로그만 지운다(재고 불변).
export async function deleteInboundAction(id: string): Promise<{ ok: boolean; reverted?: boolean }> {
  await requireAdmin();
  if (!id) return { ok: false };
  const log = await prisma.inboundLog.findUnique({ where: { id } });
  if (!log) return { ok: true }; // 이미 삭제됨
  const withinWindow = Date.now() - log.createdAt.getTime() < REVERT_WINDOW_MS;
  let reverted = false;
  if (withinWindow && log.itemId && log.qty > 0) {
    const item = await prisma.inventoryItem.findFirst({
      where: { id: log.itemId, deletedAt: null },
      select: { id: true, qty: true },
    });
    if (item) {
      await prisma.inventoryItem.update({
        where: { id: item.id },
        data: { qty: Math.max(0, item.qty - log.qty) }, // 더했던 수량만큼 되돌림(음수 방지)
      });
      await setInventoryPushPending();
      reverted = true;
    }
  }
  await prisma.inboundLog.delete({ where: { id } });
  revalidatePath("/admin/inbound");
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, reverted };
}

// 품목명 검색 — 전체 기록에서(로드된 최근분만 아니라) 최신순. 검색어 없으면 최근분.
export async function searchInboundAction(q: string): Promise<InboundRow[]> {
  await requireAdmin();
  const term = String(q ?? "").trim();
  const rows = await prisma.inboundLog.findMany({
    where: term ? { name: { contains: term } } : {},
    orderBy: { createdAt: "desc" },
    take: LIST_LIMIT,
  });
  return rows.map(toInboundRow);
}
