"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMerchant } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { validateBatchDates, isReservationClosed } from "@/lib/reservation";

export type ReservationBatchState = { ok?: boolean; error?: string };

type ProductInput = {
  id?: string | null;
  name?: string;
  supplyPrice?: string | number;
  pickupDate?: string; // 상품별 픽업일자 KST YYYY-MM-DD
  deleted?: boolean;
};
type BatchPayload = {
  batchId?: string | null;
  reserveDate?: string;
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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reserveDate)) return { error: "예약일자를 선택하세요." };

  const products = Array.isArray(payload.products) ? payload.products : [];
  const batchId = payload.batchId ? String(payload.batchId) : null;

  // 픽업일은 이제 '상품별'. 살아있는(삭제 안 됨) 이름 있는 상품마다 픽업일 필수 + 예약+2일 이상.
  const liveNamed = products.filter((p) => !p.deleted && String(p.name ?? "").trim());
  for (const p of liveNamed) {
    const pk = String(p.pickupDate ?? "").trim();
    const v = validateBatchDates(reserveDate, pk);
    if (!v.ok) return { error: `'${String(p.name).trim()}' — ${v.error}` };
  }
  // 배치 pickupDate는 하위호환용 대표값(상품 픽업 중 가장 이른 날). 상품 없으면 예약일 폴백.
  const pickups = liveNamed.map((p) => String(p.pickupDate).trim());
  const batchPickup = pickups.length ? pickups.slice().sort()[0] : reserveDate;

  let targetId = batchId;
  let created = false;

  if (batchId) {
    const existing = await prisma.reservationBatch.findFirst({
      where: { id: batchId, active: true },
      select: {
        id: true,
        reserveDate: true,
        // '확정된' 예약만 센다 — 점주가 '수정'(잠금해제)만 누르고 방치하면 confirmed:false 행이
        // 남는데, 이를 세면 실제 확정이 없는데도 관리자가 예약일자를 영영 못 바꾸게 된다.
        _count: { select: { orders: { where: { confirmed: true } } } },
      },
    });
    if (!existing) return { error: "예약 배치를 찾을 수 없어요." };
    // 확정 예약이 있으면 '예약일자'만 고정(마감 타이밍 보호). 상품별 픽업은 아이템 스냅샷으로
    // 보호되므로(확정분은 각자 스냅샷 픽업일을 유지) 관리자가 카탈로그 픽업을 조정해도 안전.
    const locked = existing._count.orders > 0;
    if (locked && reserveDate !== existing.reserveDate) {
      return { error: "이미 예약이 접수된 배치는 예약일자를 바꿀 수 없어요." };
    }
    if (!locked && reserveDate !== existing.reserveDate) {
      const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
      if (dup && dup.id !== batchId) return { error: "그 예약일자는 이미 있어요." };
    }
    await prisma.reservationBatch.update({
      where: { id: batchId },
      data: { reserveDate: locked ? existing.reserveDate : reserveDate, pickupDate: batchPickup },
    });
  } else {
    const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
    if (dup) {
      return { error: "그 예약일자는 이미 있어요. 기존 예약을 눌러 수정해 주세요." };
    }
    const b = await prisma.reservationBatch.create({
      data: { reserveDate, pickupDate: batchPickup },
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
    const pk = String(p.pickupDate ?? "").trim(); // 위에서 검증됨(예약+2 이상)
    if (pid) {
      ops.push(
        prisma.reservationProduct.updateMany({
          where: { id: pid, batchId: targetId },
          data: { name, supplyPrice, pickupDate: pk, active: true },
        }),
      );
    } else {
      ops.push(
        prisma.reservationProduct.create({
          data: {
            batchId: targetId,
            name,
            supplyPrice,
            pickupDate: pk,
            sortOrder: nextSort++,
            active: true,
          },
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
    summary: `예약 ${reserveDate} · 상품 ${liveNamed.length}개(픽업 상품별)`,
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
  const user = await requireMerchant(); // 로그인+APPROVED 강제(정지/미승인 점주 차단)
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
      products: {
        where: { active: true },
        select: { id: true, name: true, supplyPrice: true, pickupDate: true },
      },
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
          pickupDate: p.pickupDate, // 픽업일 스냅샷 — 확정 후 카탈로그 변경돼도 이 값으로 자동로드
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
  const user = await requireMerchant(); // 로그인+APPROVED 강제(정지/미승인 점주 차단)
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
