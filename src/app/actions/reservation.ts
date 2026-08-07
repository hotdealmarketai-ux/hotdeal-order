"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin, requireMerchant, getCurrentUser } from "@/lib/session";
import { needsOnboarding } from "@/lib/onboarding";
import { writeAudit } from "@/lib/audit";
import { validateBatchDates, isReservationClosed } from "@/lib/reservation";
import {
  reservationLockActiveAt,
  minLockedPickupDate,
  reservationHeldByItem,
} from "@/lib/reservation-stock";
import { heldByItem } from "@/lib/stock-hold";
import { kstTodayStr } from "@/lib/reservation-flat";
import { notifyMerchantReservationEdited } from "@/lib/push";
import { windowKeyAt } from "@/lib/schedule";
import { logError } from "@/lib/log";

export type ReservationBatchState = { ok?: boolean; error?: string };

type ProductInput = {
  id?: string | null;
  name?: string;
  supplyPrice?: string | number;
  pickupDate?: string; // 상품별 픽업일자 KST YYYY-MM-DD
  inventoryItemId?: string; // 재고현황 연동(빈값=수기)
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

  // 픽업일은 이제 '상품별'. 살아있는(삭제 안 됨) 이름 있는 상품마다 픽업일 필수 + 예약 다음날부터.
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
      if (dup && dup.id !== batchId) {
        if (dup.active) return { error: "그 예약일자는 이미 있어요." };
        // 숨겨진(삭제된) 예약이 그 날짜를 점유 중 → 하드 삭제해 유니크 충돌 해소.
        await prisma.reservationBatch.delete({ where: { id: dup.id } });
      }
    }
    await prisma.reservationBatch.update({
      where: { id: batchId },
      data: { reserveDate: locked ? existing.reserveDate : reserveDate, pickupDate: batchPickup },
    });
  } else {
    const dup = await prisma.reservationBatch.findUnique({ where: { reserveDate } });
    if (dup) {
      if (dup.active) {
        return { error: "그 예약일자는 이미 있어요. 기존 예약을 눌러 수정해 주세요." };
      }
      // 숨겨진(삭제된) 예약이 그 날짜를 점유 중 → 하드 삭제하고 새로 만든다(유니크 충돌 해소).
      await prisma.reservationBatch.delete({ where: { id: dup.id } });
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
    const invId = String(p.inventoryItemId ?? "").trim(); // 연동 재고 품목(빈값=수기)
    if (pid) {
      ops.push(
        prisma.reservationProduct.updateMany({
          where: { id: pid, batchId: targetId },
          data: { name, supplyPrice, pickupDate: pk, inventoryItemId: invId, active: true },
        }),
      );
      // 픽업일자가 바뀌면 이미 확정/담긴 아이템 스냅샷(pickupDate)도 함께 옮긴다 —
      // 발주서·출고서·계산서·본사출고는 전부 ReservationOrderItem.pickupDate(스냅샷)로 거르므로,
      // 이걸 안 바꾸면 옛 출고일 발주서에 그대로 남는다(신고된 버그).
      // 단 이미 재고 실차감된(stockDeductedAt) 아이템은 옮기지 않는다(정산 정합 보호).
      ops.push(
        prisma.reservationOrderItem.updateMany({
          where: { productId: pid, stockDeductedAt: null },
          data: { pickupDate: pk, name },
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
            inventoryItemId: invId,
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
  revalidatePath(`/admin/reservations/${targetId}`);
  // 픽업일자가 바뀌면 발주서·출고서·달력 등 스냅샷을 읽는 소비 화면도 무효화(옛 날짜에서 빠지고 새 날짜에 뜨게).
  revalidatePath("/admin/calendar");
  revalidatePath("/admin/hotdeal");
  revalidatePath("/admin/orders");
  revalidatePath("/vendor");
  revalidatePath("/vendor/summary");
  revalidatePath("/order");

  // 저장 후 항상 '목록'으로 이동 — 서버 리다이렉트라 최신 목록이 그려져 방금 저장한 예약이
  // 바로 보인다(예전엔 신규는 편집페이지로 갔는데, 그러면 목록 클라 캐시가 오래돼 '목록에 안
  // 나온다'처럼 보였다). 편집은 목록에서 그 예약을 눌러 이어서.
  redirect("/admin/reservations");
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

// 숨겨진(삭제·active=false) 예약 배치를 '완전 삭제'(상품·주문·아이템 cascade). 유니크 날짜 점유 해소.
// soft-delete는 집계 보존용이나, 같은 예약일자 재생성을 막는 부작용이 있어 관리자가 정리할 수 있게.
export async function purgeHiddenReservationsAction(): Promise<{
  ok: boolean;
  count: number;
}> {
  const admin = await requireAdmin();
  const hidden = await prisma.reservationBatch.findMany({
    where: { active: false },
    select: { id: true },
  });
  const ids = hidden.map((h) => h.id);
  let count = 0;
  if (ids.length > 0) {
    const res = await prisma.reservationBatch.deleteMany({ where: { id: { in: ids } } });
    count = res.count;
  }
  await writeAudit({
    action: "reservation.purgeHidden",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationBatch",
    targetId: "",
    summary: `숨겨진 예약 ${count}개 완전삭제`,
  });
  revalidatePath("/admin/reservations");
  return { ok: true, count };
}

// ── 점주(핫딜마켓) 예약 확정/수정 ─────────────────────────────

// 확정 = 수량 저장 + 잠금. 마감 전에만. (0 수량만 있으면 클라에서 버튼 비활성 → 항상 1개↑ 전제)
export async function confirmReservationAction(formData: FormData) {
  const user = await requireMerchant(); // 로그인+APPROVED 강제(정지/미승인 점주 차단)
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  if (needsOnboarding(user)) redirect("/onboarding");
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
        select: { id: true, name: true, supplyPrice: true, pickupDate: true, inventoryItemId: true },
      },
    },
  });
  if (!batch) redirect("/reservations");
  if (isReservationClosed(batch.reserveDate)) redirect(`/reservations/${batchId}`); // 마감 후 확정 불가

  // 확정 흐름은 '수기 상품'만 다룬다 — 연동(재고) 상품은 실시간 담기(holdReservationAction)가 관리.
  const pmap = new Map(batch.products.map((p) => [p.id, p]));
  const clean = (Array.isArray(raw) ? raw : [])
    .map((i) => ({ productId: String(i.productId ?? ""), qty: toInt(i.qty, 0) }))
    .filter((i) => {
      const p = pmap.get(i.productId);
      return !!p && !p.inventoryItemId && i.qty > 0; // 연동 상품은 제외
    });

  const order = await prisma.reservationOrder.upsert({
    where: { userId_batchId: { userId: user.id, batchId } },
    create: { userId: user.id, batchId, confirmed: true, confirmedAt: new Date() },
    update: { confirmed: true, confirmedAt: new Date() },
    select: { id: true },
  });
  await prisma.$transaction([
    // 수기 상품행만 삭제/재생성 — 연동 상품행(inventoryItemId 있음)은 그대로 보존.
    prisma.reservationOrderItem.deleteMany({ where: { orderId: order.id, inventoryItemId: "" } }),
    ...clean.map((i, idx) => {
      const p = pmap.get(i.productId)!;
      return prisma.reservationOrderItem.create({
        data: {
          orderId: order.id,
          productId: i.productId,
          name: p.name,
          supplyPrice: p.supplyPrice,
          pickupDate: p.pickupDate, // 픽업일 스냅샷 — 확정 후 카탈로그 변경돼도 이 값으로 자동로드
          inventoryItemId: "", // 수기 상품
          qty: i.qty,
          sortOrder: idx,
        },
      });
    }),
  ]);

  // 남은 아이템(방금 수기 + 연동 홀드)이 0이면 '확정'이 아니라 '없음'으로 → 목록 '예약 중' 풀림.
  // (점주가 수량을 다 지워 '예약 비우기'를 눌렀을 때 예약이 깔끔히 해제되게)
  const remaining = await prisma.reservationOrderItem.count({ where: { orderId: order.id } });
  if (remaining === 0) {
    await prisma.reservationOrder.update({
      where: { id: order.id },
      data: { confirmed: false, confirmedAt: null },
    });
  }

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
    const order = await prisma.reservationOrder.findFirst({
      where: { userId: user.id, batchId },
      select: { id: true },
    });
    if (order) {
      // 잠금 해제 시 confirmed 뿐 아니라 품목 confirmedAt 도 함께 해제해야 한다.
      // 공구 자동로드 게이트가 (order.confirmed OR item.confirmedAt) 이므로, confirmedAt 를 안 지우면
      // Phase1 백필로 채워진 옛 확정분이 잠금해제 후에도 발주서/출고서/계산서에 계속 뜬다.
      await prisma.$transaction([
        prisma.reservationOrder.update({
          where: { id: order.id },
          data: { confirmed: false },
        }),
        prisma.reservationOrderItem.updateMany({
          where: { orderId: order.id },
          data: { confirmedAt: null },
        }),
      ]);
    }
  }
  revalidatePath(`/reservations/${batchId}`);
  redirect(`/reservations/${batchId}`);
}

// ── 연동(재고현황) 예약 상품 실시간 담기 ──────────────────────
// 재고에서 불러온 연동 상품은 일일 담기처럼 −/+ 하는 즉시 예약수량=홀드로 저장(공유·초과차단).
// confirmed 는 건드리지 않는다(수기 상품의 확정상태 보존). qty 0 이면 그 상품 예약행만 삭제.
export type ResvHoldResult = { ok: boolean; error?: string; available?: number };

export async function holdReservationAction(input: {
  batchId: string;
  productId: string;
  qty: number;
}): Promise<ResvHoldResult> {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || user.role !== "MERCHANT_HOTDEAL") {
    return { ok: false, error: "권한이 없어요." };
  }
  const batchId = String(input.batchId ?? "");
  const productId = String(input.productId ?? "");
  const qty = Math.min(99999, Math.max(0, Math.floor(Number(input.qty) || 0))); // 상한(오타·폭주 방지)

  const product = await prisma.reservationProduct.findFirst({
    where: {
      id: productId,
      batchId,
      active: true,
      inventoryItemId: { not: "" },
      batch: { active: true },
    },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      inventoryItemId: true,
      batch: { select: { reserveDate: true } },
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (isReservationClosed(product.batch.reserveDate)) {
    return { ok: false, error: "예약이 마감됐어요." };
  }
  if (!reservationLockActiveAt(product.pickupDate)) {
    return { ok: false, error: "픽업일이 지나 담을 수 없어요." };
  }

  const itemId = product.inventoryItemId;
  const gte = minLockedPickupDate();

  try {
    const res = await prisma.$transaction(async (tx) => {
      // 일일 담기와 같은 락으로 이 품목 담기를 직렬화(동시 초과 방지)
      await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { qty: true, deletedAt: true },
      });
      if (!item || item.deletedAt) {
        return { ok: false, error: "재고 품목을 찾을 수 없어요." };
      }

      // 전체 예약홀드(연동·픽업 10시 전·활성 배치) − 내 이 상품 현재 수량
      const resvRows = await tx.reservationOrderItem.findMany({
        where: {
          inventoryItemId: itemId,
          pickupDate: { gte },
          qty: { gt: 0 },
          order: { batch: { active: true } },
        },
        select: { qty: true, productId: true, order: { select: { userId: true } } },
      });
      let resvHeld = 0;
      let myThis = 0;
      for (const r of resvRows) {
        resvHeld += r.qty;
        if (r.order.userId === user.id && r.productId === productId) myThis += r.qty;
      }
      // 일일 담기 홀드(연동 잠긴 품목이면 보통 0이나, 잠금 직전 담긴 게 있을 수 있어 함께 차감)
      const dayAgg = await tx.stockHold.aggregate({
        where: { itemId, windowDate: windowKeyAt() },
        _sum: { qty: true },
      });
      const availableForMe = item.qty - (resvHeld - myThis) - (dayAgg._sum.qty ?? 0);

      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId: user.id, batchId } },
        select: { id: true },
      });

      if (qty <= 0) {
        if (order) {
          await tx.reservationOrderItem.deleteMany({
            where: { orderId: order.id, productId },
          });
        }
        return { ok: true, available: Math.max(0, availableForMe) };
      }
      if (qty > availableForMe) {
        return {
          ok: false,
          error: `남은 수량이 부족해요. (담을 수 있는 최대 ${Math.max(0, availableForMe)}개)`,
          available: Math.max(0, availableForMe),
        };
      }
      // 주문 보장(confirmed 는 건드리지 않음 — 수기분 확정상태 유지)
      const oid =
        order?.id ??
        (
          await tx.reservationOrder.create({
            data: { userId: user.id, batchId, confirmed: false },
            select: { id: true },
          })
        ).id;
      await tx.reservationOrderItem.upsert({
        where: { orderId_productId: { orderId: oid, productId } },
        create: {
          orderId: oid,
          productId,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: itemId,
          qty,
        },
        update: {
          qty,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: itemId,
        },
      });
      return { ok: true, available: Math.max(0, availableForMe - qty) };
    });
    revalidatePath(`/reservations/${batchId}`);
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("reservation.hold", err, { batchId, productId, userId: user.id });
    return { ok: false, error: "담기에 실패했어요. 다시 시도해 주세요." };
  }
}

// ── 관리자: 특정 점포의 예약 수량 편집/삭제 ──
// edits: [{itemId, qty}] — qty<=0 이면 그 예약 품목 삭제. 예약 수량은 ReservationOrderItem.qty 자체가 곧 홀드라
// 여기서 qty만 바꾸면 판매가능·자동로드가 자동 반영된다(StockHold 안 건드림). 연동(inventoryItemId≠"") 증가는
// 재고 가용으로 캡(음수 재고 방지). 이미 출고(stockDeductedAt≠null)된 품목은 수정 불가(이중 반영 방지).
// 저장 후 점주에게 푸시 + ReservationChangeLog(점주 열람용) 기록. ⚠ 관리자 전용(requireAdmin).
export async function adminEditReservationItemsAction(input: {
  batchId: string;
  userId: string;
  edits: { itemId: string; qty: number }[];
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  const batchId = String(input?.batchId ?? "");
  const userId = String(input?.userId ?? "");
  const rawEdits = Array.isArray(input?.edits) ? input.edits : [];
  if (!batchId || !userId) return { ok: false, error: "잘못된 요청이에요." };

  const order = await prisma.reservationOrder.findFirst({
    where: { batchId, userId },
    select: {
      id: true,
      user: { select: { storeName: true } },
      items: {
        select: {
          id: true,
          name: true,
          qty: true,
          inventoryItemId: true,
          stockDeductedAt: true,
        },
      },
    },
  });
  if (!order) return { ok: false, error: "예약을 찾을 수 없어요." };
  const byId = new Map(order.items.map((it) => [it.id, it]));

  type Change = { item: (typeof order.items)[number]; qty: number };
  const changes: Change[] = [];
  for (const e of rawEdits) {
    const it = byId.get(String(e?.itemId ?? ""));
    if (!it) continue;
    const qty = Math.max(0, Math.floor(Number(e?.qty) || 0));
    if (qty === it.qty) continue; // 변화 없음 — 건너뜀(출고 품목이어도 무해)
    if (it.stockDeductedAt)
      return { ok: false, error: `${it.name}은(는) 이미 출고돼 수정할 수 없어요.` };
    changes.push({ item: it, qty });
  }
  if (changes.length === 0) return { ok: true };

  // 연동 품목 '증가'는 재고 가용 캡. cap = base − 전체예약홀드 − 일일홀드 + 이 행 현재수량.
  const linkedUp = changes.filter(
    (c) => c.item.inventoryItemId && c.qty > c.item.qty,
  );
  if (linkedUp.length > 0) {
    const [resvHeld, dailyHeld] = await Promise.all([
      reservationHeldByItem(),
      heldByItem(),
    ]);
    const iids = [...new Set(linkedUp.map((c) => c.item.inventoryItemId))];
    const invs = await prisma.inventoryItem.findMany({
      where: { id: { in: iids } },
      select: { id: true, qty: true },
    });
    const baseById = new Map(invs.map((i) => [i.id, i.qty]));
    // iid별 '남은 재고 풀' = base − 전체예약홀드 − 일일홀드(이 저장의 증가 반영 전).
    // 같은 재고품목을 여러 행이 함께 늘릴 때 풀을 순차 소진해야 초과판매가 안 난다.
    const pool = new Map<string, number>();
    for (const iid of iids)
      pool.set(
        iid,
        (baseById.get(iid) ?? 0) - (resvHeld[iid] ?? 0) - (dailyHeld[iid] ?? 0),
      );
    for (const c of linkedUp) {
      const iid = c.item.inventoryItemId;
      const inc = c.qty - c.item.qty; // 증가량
      const left = pool.get(iid) ?? 0;
      if (inc > left) {
        return {
          ok: false,
          error: `${c.item.name} 재고가 부족해요(최대 ${c.item.qty + Math.max(0, left)}개).`,
        };
      }
      pool.set(iid, left - inc);
    }
  }

  const logChanges = changes.map((c) => ({
    name: c.item.name,
    op: c.qty <= 0 ? "removed" : "changed",
    before: c.item.qty,
    after: c.qty,
  }));

  try {
    await prisma.$transaction(async (tx) => {
      for (const c of changes) {
        if (c.qty <= 0)
          await tx.reservationOrderItem.delete({ where: { id: c.item.id } });
        else
          await tx.reservationOrderItem.update({
            where: { id: c.item.id },
            data: { qty: c.qty },
          });
      }
      const remaining = await tx.reservationOrderItem.count({
        where: { orderId: order.id },
      });
      if (remaining === 0) {
        await tx.reservationOrder.update({
          where: { id: order.id },
          data: { confirmed: false, confirmedAt: null },
        });
      }
      await tx.reservationChangeLog.create({
        data: {
          batchId,
          userId,
          actorName: admin.storeName,
          changes: JSON.stringify(logChanges),
        },
      });
    });
  } catch (err) {
    logError("reservation.adminEdit", err, { batchId, userId });
    return { ok: false, error: "수정에 실패했어요. 다시 시도해 주세요." };
  }

  await writeAudit({
    action: "reservation.adminEditStore",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationOrder",
    targetId: order.id,
    summary: `${order.user.storeName} 예약 수정 — ${changes.length}건`,
    snapshot: logChanges,
  }).catch(() => {});
  await notifyMerchantReservationEdited(userId, batchId);

  revalidatePath(`/admin/reservations/${batchId}`);
  revalidatePath("/reservations");
  revalidatePath(`/reservations/${batchId}`);
  revalidatePath("/inventory");
  revalidatePath("/order");
  revalidatePath("/vendor");
  revalidatePath("/admin/hotdeal");
  revalidatePath("/admin");
  return { ok: true };
}

// ── 관리자: flat 예약상품의 특정 점포 수량 '설정'(0 포함) ──
// (productId, userId, qty) 로 식별 — 발주를 안 넣은 지점도 여기서 수량을 넣으면 그 점주에게 예약이 생긴다.
// 즉, 관리자가 추가한 수량은 확정(confirmedAt) 상태로 저장돼 그 점주 화면·공구·계산서에 그대로 반영된다.
//  · qty>기존: 연동 상품이면 재고 가용으로 캡(초과판매 방지). 신규면 주문+아이템을 확정 생성.
//  · qty=0    : 그 예약 아이템 삭제(주문이 비면 confirmed 해제).
//  · 픽업일 지남(지난 픽업 마감)·이미 출고(stockDeductedAt)면 수정 불가.
// 저장 후 점주 푸시 + ReservationChangeLog 기록. ⚠ 관리자 전용(requireAdmin).
export async function adminSetReservationStoreQtyAction(input: {
  productId: string;
  userId: string;
  qty: number;
}): Promise<{ ok: boolean; error?: string }> {
  const admin = await requireAdmin();
  const productId = String(input?.productId ?? "");
  const userId = String(input?.userId ?? "");
  const qty = Math.min(99999, Math.max(0, Math.floor(Number(input?.qty) || 0))); // 상한(오타·폭주 방지)
  if (!productId || !userId) return { ok: false, error: "잘못된 요청이에요." };

  const product = await prisma.reservationProduct.findFirst({
    where: { id: productId, active: true, closeAt: { not: null }, batch: { active: true } },
    select: {
      id: true,
      name: true,
      supplyPrice: true,
      pickupDate: true,
      inventoryItemId: true,
      batchId: true,
      stockFixed: true,
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  // 지난 픽업 마감(픽업일까지 지남)은 편집 불가 — 아카이브.
  if (product.pickupDate < kstTodayStr()) {
    return { ok: false, error: "픽업일이 지나 수정할 수 없어요." };
  }

  const target = await prisma.user.findFirst({
    where: { id: userId, role: "MERCHANT_HOTDEAL", status: "APPROVED" },
    select: { id: true, storeName: true },
  });
  if (!target) return { ok: false, error: "가맹점을 찾을 수 없어요." };

  // 모든 판정·집계·쓰기를 하나의 트랜잭션 안에서. 연동 상품이면 재고행을 FOR UPDATE 로 잠가
  // 점주 담기(holdFlatProductAction)·다른 관리자 편집과 직렬화(동시 초과판매 방지).
  const iid = product.inventoryItemId;
  let outcome: { ok: boolean; error?: string; curQty?: number; noop?: boolean };
  try {
    outcome = await prisma.$transaction(async (tx) => {
      if (iid) {
        await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${iid} FOR UPDATE`;
      }
      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId, batchId: product.batchId } },
        select: { id: true },
      });
      const existing = order
        ? await tx.reservationOrderItem.findUnique({
            where: { orderId_productId: { orderId: order.id, productId } },
            select: { id: true, qty: true, confirmedAt: true, stockDeductedAt: true },
          })
        : null;
      const curQty = existing?.qty ?? 0;

      if (existing?.stockDeductedAt) {
        return { ok: false, error: `${product.name}은(는) 이미 출고돼 수정할 수 없어요.` };
      }
      // 점주가 담는 중(미확정 홀드)인 예약은 본사가 덮어쓰지 않는다 — 편집 화면엔 '담는 중'으로만 뜨고
      // 확정수량(0)과 실제 홀드 수량이 달라 조용히 뭉개질 위험이 있어 명시적으로 막는다.
      if (existing && existing.confirmedAt == null && existing.qty > 0) {
        return {
          ok: false,
          error: "점주가 담는 중(미확정)이라 지금은 수정할 수 없어요. 점주 발주 확정 후 조정해 주세요.",
        };
      }
      if (qty === curQty) return { ok: true, noop: true, curQty };

      // 연동 '증가'는 재고 가용으로 캡 — 단 '재고 고정' 상품만. 기본(초과발주 허용)은 넘어도 저장.
      if (iid && product.stockFixed && qty > curQty) {
        const inv = await tx.inventoryItem.findUnique({
          where: { id: iid },
          select: { qty: true, deletedAt: true },
        });
        if (!inv || inv.deletedAt) return { ok: false, error: "재고 품목을 찾을 수 없어요." };
        // 이 품목에 걸린 '아직 차감 안 된' 전체 예약홀드(내 현재 수량 포함) + 일일홀드.
        const resvRows = await tx.reservationOrderItem.findMany({
          where: {
            inventoryItemId: iid,
            stockDeductedAt: null,
            qty: { gt: 0 },
            order: { batch: { active: true } },
          },
          select: { qty: true },
        });
        let resvHeld = 0;
        for (const r of resvRows) resvHeld += r.qty;
        const dayAgg = await tx.stockHold.aggregate({
          where: { itemId: iid, windowDate: windowKeyAt() },
          _sum: { qty: true },
        });
        // 새 수량 최대치 = base − (내 것 제외 전체 예약홀드) − 일일홀드. resvHeld 는 curQty 포함이라 빼준다.
        const capMax = inv.qty - (resvHeld - curQty) - (dayAgg._sum.qty ?? 0);
        if (qty > capMax) {
          return { ok: false, error: `${product.name} 재고가 부족해요(최대 ${Math.max(0, capMax)}개).` };
        }
      }

      // 주문 보장 — flat 주문의 confirmed 는 건드리지 않는다(항목별 confirmedAt 가 게이트).
      // order.confirmed=true 로 만들면 그 점주의 '담기만 한' 다른 품목까지 계산서로 새어나간다.
      let orderId = order?.id;
      if (!orderId) {
        const created = await tx.reservationOrder.create({
          data: { userId, batchId: product.batchId },
          select: { id: true },
        });
        orderId = created.id;
      }

      if (qty <= 0) {
        if (existing) await tx.reservationOrderItem.delete({ where: { id: existing.id } });
      } else if (existing) {
        await tx.reservationOrderItem.update({
          where: { id: existing.id },
          data: {
            qty,
            confirmedAt: new Date(), // 관리자 설정분은 확정 → 점주·공구·계산서 반영
            name: product.name,
            supplyPrice: product.supplyPrice,
            pickupDate: product.pickupDate,
            inventoryItemId: iid,
          },
        });
      } else {
        await tx.reservationOrderItem.create({
          data: {
            orderId,
            productId,
            name: product.name,
            supplyPrice: product.supplyPrice,
            pickupDate: product.pickupDate,
            inventoryItemId: iid,
            qty,
            confirmedAt: new Date(),
          },
        });
      }

      // 주문이 비면 confirmed 해제(있던 경우; 신규는 애초에 false).
      const remaining = await tx.reservationOrderItem.count({ where: { orderId } });
      if (remaining === 0) {
        await tx.reservationOrder.update({
          where: { id: orderId },
          data: { confirmed: false, confirmedAt: null },
        });
      }

      await tx.reservationChangeLog.create({
        data: {
          batchId: product.batchId,
          userId,
          actorName: admin.storeName,
          changes: JSON.stringify([
            { name: product.name, op: qty <= 0 ? "removed" : "changed", before: curQty, after: qty },
          ]),
        },
      });
      return { ok: true, curQty };
    });
  } catch (err) {
    logError("reservation.adminSetStoreQty", err, { productId, userId });
    return { ok: false, error: "수정에 실패했어요. 다시 시도해 주세요." };
  }

  if (!outcome.ok) return { ok: false, error: outcome.error };
  if (outcome.noop) return { ok: true };
  const curQty = outcome.curQty ?? 0;

  await writeAudit({
    action: "reservation.adminSetStoreQty",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationProduct",
    targetId: productId,
    summary: `${target.storeName} · ${product.name} 예약 ${curQty}→${qty}개`,
    snapshot: [{ name: product.name, before: curQty, after: qty }],
  }).catch(() => {});
  // flat 예약분 수정 알림은 flat 목록(/reservations)으로 딥링크 — flat 배치 id 는 레거시 상세를 깨뜨림.
  await notifyMerchantReservationEdited(userId, product.batchId, "/reservations");

  revalidatePath(`/admin/reservations/product/${productId}`);
  revalidatePath("/admin/reservations");
  revalidatePath("/reservations");
  revalidatePath("/reservations/closed");
  revalidatePath("/inventory");
  revalidatePath("/order");
  revalidatePath("/vendor");
  revalidatePath("/admin/hotdeal");
  revalidatePath("/admin");
  return { ok: true };
}
