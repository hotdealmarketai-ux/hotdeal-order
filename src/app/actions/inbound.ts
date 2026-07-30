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

// 입고 — 재고현황에 반영 + 입고 기록(로그) 생성.
// 재고 반영: 같은 이름 품목이 있으면 수량을 '가산'(입고=재고 추가)하고 공급가/유통기한/카테고리는
// 새로 입력한 값이 있을 때만 최신값으로 갱신. 없으면 새 품목 생성(재고현황 작성 양식과 동일 필드).
export async function createInboundAction(input: {
  name: string;
  qty: string | number;
  supplyPrice: string | number;
  expiry: string;
  majorCat: string;
}): Promise<{ ok: boolean; row?: InboundRow; error?: string }> {
  await requireAdmin();
  const name = String(input.name ?? "").trim();
  if (!name) return { ok: false, error: "품목명을 입력해주세요." };
  const qty = toInt(input.qty);
  const supplyPrice = toInt(input.supplyPrice);
  const expiry = normalizeExpiry(String(input.expiry ?? ""));
  const majorCat = String(input.majorCat ?? "").trim().slice(0, 40);

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
      },
    });
    itemId = dup.id;
  } else {
    const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
    const created = await prisma.inventoryItem.create({
      data: { name, qty, supplyPrice, expiry, majorCat, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
    itemId = created.id;
  }

  // 2) 입고 기록(로그) — 입고 당시 스냅샷(영구 보존)
  const log = await prisma.inboundLog.create({
    data: { name, qty, supplyPrice, expiry, majorCat, itemId },
  });

  await setInventoryPushPending(); // 시트 반영(단방향 push 대상 표시)
  revalidatePath("/admin/inbound");
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, row: toInboundRow(log) };
}

// 입고 기록 삭제 — 로그만 지운다. 재고현황 수량은 건드리지 않는다(실재고는 재고현황에서 관리).
export async function deleteInboundAction(id: string): Promise<{ ok: boolean }> {
  await requireAdmin();
  if (!id) return { ok: false };
  await prisma.inboundLog.deleteMany({ where: { id } });
  revalidatePath("/admin/inbound");
  return { ok: true };
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
