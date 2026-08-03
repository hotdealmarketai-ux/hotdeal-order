"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { getOrCreateFlatBatchId } from "@/lib/reservation-flat";

const toInt = (v: unknown, min = 0) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[^\d-]/g, "")));
  return Number.isFinite(n) && n >= min ? n : min;
};

// datetime-local(브라우저=KST 가정) "YYYY-MM-DDTHH:MM[:SS]" → UTC Date(+09:00).
function parseCloseAtKst(local: string): Date | null {
  const s = String(local ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const withSec = s.length === 16 ? `${s}:00` : s;
  const d = new Date(`${withSec}+09:00`);
  return isNaN(d.getTime()) ? null : d;
}
// UTC Date → KST YYYY-MM-DD
function kstDateOf(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export type FlatProductState = { ok?: boolean; error?: string };

// 관리자: 신규 '단일 목록' 예약상품 등록/수정/삭제. 상품별 마감(closeAt, 시분초) + 픽업(출고)일.
export async function saveFlatProductAction(
  _prev: FlatProductState,
  formData: FormData,
): Promise<FlatProductState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  const deleted = formData.get("deleted") === "true";

  if (deleted) {
    if (!id) return { error: "잘못된 요청이에요." };
    await prisma.reservationProduct.updateMany({
      where: { id, closeAt: { not: null } },
      data: { active: false },
    });
    await writeAudit({
      action: "reservation.flatDelete",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "ReservationProduct",
      targetId: id,
      summary: "예약상품 삭제(숨김)",
    }).catch(() => {});
    revalidatePath("/admin/reservations");
    revalidatePath("/reservations");
    return { ok: true };
  }

  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const closeAt = parseCloseAtKst(String(formData.get("closeAt") ?? ""));
  const pickupDate = String(formData.get("pickupDate") ?? "").trim();
  const supplyPrice = toInt(formData.get("supplyPrice"), 0);
  const inventoryItemId = String(formData.get("inventoryItemId") ?? "").trim();

  if (!name) return { error: "상품명을 입력하세요." };
  if (!closeAt) return { error: "예약 마감 시각을 정확히 입력하세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return { error: "픽업(출고)일을 선택하세요." };
  if (pickupDate < kstDateOf(closeAt)) {
    return { error: "픽업(출고)일은 예약 마감일 이후여야 해요." };
  }

  if (id) {
    const existing = await prisma.reservationProduct.findFirst({
      where: { id, closeAt: { not: null } },
      select: { id: true },
    });
    if (!existing) return { error: "상품을 찾을 수 없어요." };
    await prisma.$transaction([
      prisma.reservationProduct.update({
        where: { id },
        data: { name, closeAt, pickupDate, supplyPrice, inventoryItemId, active: true },
      }),
      // 픽업/이름 변경분을 미차감 예약 스냅샷에 전파(자동로드 필터 정합) — 레거시 저장 액션과 동일 규칙.
      prisma.reservationOrderItem.updateMany({
        where: { productId: id, stockDeductedAt: null },
        data: { pickupDate, name },
      }),
    ]);
  } else {
    const batchId = await getOrCreateFlatBatchId();
    const maxAgg = await prisma.reservationProduct.aggregate({
      where: { batchId },
      _max: { sortOrder: true },
    });
    await prisma.reservationProduct.create({
      data: {
        batchId,
        name,
        closeAt,
        pickupDate,
        supplyPrice,
        inventoryItemId,
        sortOrder: (maxAgg._max.sortOrder ?? 0) + 1,
        active: true,
      },
    });
  }

  await writeAudit({
    action: id ? "reservation.flatUpdate" : "reservation.flatCreate",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationProduct",
    targetId: id || "",
    summary: `예약상품 ${name} · 픽업 ${pickupDate}`,
  }).catch(() => {});

  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");
  revalidatePath("/admin/calendar");
  return { ok: true };
}
