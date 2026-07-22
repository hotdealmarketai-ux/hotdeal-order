"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { validateBatchDates, isReservationClosed } from "@/lib/reservation";

export type ReservationBatchState = { ok?: boolean; error?: string };

type ProductInput = {
  id?: string | null;
  name?: string;
  supplyPrice?: string | number;
  deleted?: boolean;
};
type BatchPayload = {
  batchId?: string | null;
  reserveDate?: string;
  pickupDate?: string;
  products?: ProductInput[];
};

const toInt = (v: unknown, min = 0) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[^\d-]/g, "")));
  return Number.isFinite(n) && n >= min ? n : min;
};

// 관리자: 예약 배치(예약일자·픽업일자) + 상품 카탈로그 저장(생성/수정/소프트삭제).
export async function saveReservationBatchAction(
  _prev: ReservationBatchState,
  formData: FormData,
): Promise<ReservationBatchState> {
  const admin = await requireAdmin();
  let payload: BatchPayload = {};
  try {
    payload = JSON.parse(String(formData.get("payload") ?? "{}"));
  } catch {
    return { error: "입력을 읽지 못했어요. 다시 시도해 주세요." };
  }

  const reserveDate = String(payload.reserveDate ?? "").trim();
  const pickupDate = String(payload.pickupDate ?? "").trim();
  const v = validateBatchDates(reserveDate, pickupDate);
  if (!v.ok) return { error: v.error };

  const products = Array.isArray(payload.products) ? payload.products : [];
  const batchId = payload.batchId ? String(payload.batchId) : null;

  let targetId = batchId;
  let created = false;

  if (batchId) {
    const existing = await prisma.reservationBatch.findFirst({
      where: { id: batchId, active: true },
      select: { id: true, reserveDate: true, pickupDate: true, _count: { select: { orders: true } } },
    });
    if (!existing) return { error: "예약 배치를 찾을 수 없어요." };
    // 이미 점주 예약이 있으면 날짜 변경 금지(마감/로드 타이밍 어긋남 방지) — 기존 날짜 유지.
    if (existing._count.orders > 0) {
      if (reserveDate !== existing.reserveDate || pickupDate !== existing.pickupDate) {
        return { error: "이미 예약이 접수된 배치는 날짜를 바꿀 수 없어요." };
      }
    } else {
      // reserveDate 를 다른 배치와 겹치게 바꾸려 하면 거절
      if (reserveDate !== existing.reserveDate) {
        const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
        if (dup && dup.id !== batchId) return { error: "그 예약일자는 이미 있어요." };
      }
      await prisma.reservationBatch.update({
        where: { id: batchId },
        data: { reserveDate, pickupDate },
      });
    }
  } else {
    const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
    if (dup) {
      return { error: "그 예약일자는 이미 있어요. 기존 예약을 눌러 수정해 주세요." };
    }
    const b = await prisma.reservationBatch.create({
      data: { reserveDate, pickupDate },
      select: { id: true },
    });
    targetId = b.id;
    created = true;
  }

  if (!targetId) return { error: "저장에 실패했어요." };

  // 상품 upsert / 소프트삭제
  const maxAgg = await prisma.reservationProduct.aggregate({
    where: { batchId: targetId },
    _max: { sortOrder: true },
  });
  let nextSort = (maxAgg._max.sortOrder ?? 0) + 1;

  const ops = [];
  for (const p of products) {
    const pid = p.id ? String(p.id) : null;
    if (p.deleted) {
      if (pid) {
        ops.push(
          prisma.reservationProduct.updateMany({
            where: { id: pid, batchId: targetId },
            data: { active: false },
          }),
        );
      }
      continue;
    }
    const name = String(p.name ?? "").trim().slice(0, 100);
    if (!name) continue; // 이름 없는 빈 추가행 무시
    const supplyPrice = toInt(p.supplyPrice, 0);
    if (pid) {
      ops.push(
        prisma.reservationProduct.updateMany({
          where: { id: pid, batchId: targetId },
          data: { name, supplyPrice, active: true },
        }),
      );
    } else {
      ops.push(
        prisma.reservationProduct.create({
          data: { batchId: targetId, name, supplyPrice, sortOrder: nextSort++, active: true },
        }),
      );
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);

  await writeAudit({
    action: created ? "reservation.batchCreate" : "reservation.batchUpdate",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationBatch",
    targetId,
    summary: `예약 ${reserveDate} · 픽업 ${pickupDate} · 상품 ${products.filter((p) => !p.deleted && String(p.name ?? "").trim()).length}개`,
  });

  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");

  // 신규 생성이면 편집 페이지로 이동(이후 상품 추가 편집이 그 배치를 가리키게)
  if (created) redirect(`/admin/reservations/${targetId}`);
  return { ok: true };
}

// 관리자: 예약 배치 소프트삭제(숨김). 점주 예약이 있으면 경고만 하고 그대로 진행(집계는 남음).
export async function deleteReservationBatchAction(formData: FormData) {
  const admin = await requireAdmin();
  const batchId = String(formData.get("batchId") ?? "");
  if (!batchId) redirect("/admin/reservations");
  const b = await prisma.reservationBatch.findUnique({
    where: { id: batchId },
    select: { reserveDate: true },
  });
  await prisma.reservationBatch.updateMany({
    where: { id: batchId },
    data: { active: false },
  });
  await writeAudit({
    action: "reservation.batchDelete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationBatch",
    targetId: batchId,
    summary: `예약일자 ${b?.reserveDate ?? "?"} 삭제(숨김)`,
  });
  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");
  redirect("/admin/reservations");
}

// ── 점주(핫딜마켓) 예약 확정/수정 ─────────────────────────────

// 확정 = 수량 저장 + 잠금. 마감 전에만. (0 수량만 있으면 클라에서 버튼 비활성 → 항상 1개↑ 전제)
export async function confirmReservationAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const batchId = String(formData.get("batchId") ?? "");
  let raw: { productId?: string; qty?: number | string }[] = [];
  try {
    raw = JSON.parse(String(formData.get("items") ?? "[]"));
  } catch {
    raw = [];
  }

  const batch = await prisma.reservationBatch.findFirst({
    where: { id: batchId, active: true },
    select: {
      reserveDate: true,
      products: { where: { active: true }, select: { id: true, name: true, supplyPrice: true } },
    },
  });
  if (!batch) redirect("/reservations");
  if (isReservationClosed(batch.reserveDate)) redirect(`/reservations/${batchId}`); // 마감 후 확정 불가

  const pmap = new Map(batch.products.map((p) => [p.id, p]));
  const clean = (Array.isArray(raw) ? raw : [])
    .map((i) => ({ productId: String(i.productId ?? ""), qty: toInt(i.qty, 0) }))
    .filter((i) => pmap.has(i.productId) && i.qty > 0);

  const order = await prisma.reservationOrder.upsert({
    where: { userId_batchId: { userId: user.id, batchId } },
    create: { userId: user.id, batchId, confirmed: true, confirmedAt: new Date() },
    update: { confirmed: true, confirmedAt: new Date() },
    select: { id: true },
  });
  await prisma.$transaction([
    prisma.reservationOrderItem.deleteMany({ where: { orderId: order.id } }),
    ...clean.map((i, idx) => {
      const p = pmap.get(i.productId)!;
      return prisma.reservationOrderItem.create({
        data: {
          orderId: order.id,
          productId: i.productId,
          name: p.name,
          supplyPrice: p.supplyPrice,
          qty: i.qty,
          sortOrder: idx,
        },
      });
    }),
  ]);

  revalidatePath("/reservations");
  revalidatePath(`/reservations/${batchId}`);
  redirect(`/reservations/${batchId}`);
}

// 수정 = 잠금 해제(수량은 유지). 마감 후엔 불가.
export async function unlockReservationAction(formData: FormData) {
  const user = await requireUser();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const batchId = String(formData.get("batchId") ?? "");
  const batch = await prisma.reservationBatch.findFirst({
    where: { id: batchId, active: true },
    select: { reserveDate: true },
  });
  if (!batch) redirect("/reservations");
  if (!isReservationClosed(batch.reserveDate)) {
    await prisma.reservationOrder.updateMany({
      where: { userId: user.id, batchId },
      data: { confirmed: false },
    });
  }
  revalidatePath(`/reservations/${batchId}`);
  redirect(`/reservations/${batchId}`);
}
