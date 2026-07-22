"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { kstDayRange, kstDateOf } from "@/lib/date";
import { safePushInventory, setInventoryPushPending } from "@/lib/inventory-sheet";
import {
  currentWindowStartUtc,
  currentDeadlineUtc,
} from "@/lib/schedule";
import { hasOrderWindow } from "@/lib/deadline";
import {
  notifyMerchantOrdersCancelled,
  notifyMerchantSignupApproved,
  notifyMerchantSignupRejected,
} from "@/lib/push";
import { writeAudit } from "@/lib/audit";
import {
  ALL_ROLES,
  ASSIGNABLE_MERCHANT_ROLES,
  type Role,
  type Status,
} from "@/lib/constants";

const EDITABLE_STATUSES: Status[] = ["APPROVED", "SUSPENDED", "PENDING", "REJECTED"];

export type MemberFormState = { ok?: boolean; error?: string };

// 회원 개인정보 + 역할 + 승인상태 수정
export async function updateMemberAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "잘못된 요청이에요." };

  const storeName = String(formData.get("storeName") ?? "").trim().slice(0, 100);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const address = String(formData.get("address") ?? "").trim().slice(0, 200);
  let role = String(formData.get("role") ?? "") as Role;
  let status = String(formData.get("status") ?? "") as Status;

  // 입금자명 — 콤마/줄바꿈으로 여러 개, 중복·공백 정리
  const payerNames = [
    ...new Set(
      String(formData.get("payerNames") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 60)),
    ),
  ].slice(0, 20);

  if (!ALL_ROLES.includes(role)) return { error: "올바르지 않은 역할이에요." };
  if (!EDITABLE_STATUSES.includes(status)) return { error: "올바르지 않은 상태예요." };
  if (!storeName) return { error: "상호명을 입력하세요." };

  // 본인(관리자) 계정은 역할/상태를 낮춰 스스로 잠그지 못하게 보호
  if (userId === admin.id) {
    role = "ADMIN_SAEROP";
    status = "APPROVED";
  }

  await prisma.user.update({
    where: { id: userId },
    data: { storeName, phone, address, role, status, payerNames },
  });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
  return { ok: true };
}

// 정지/복구 토글
export async function setMemberStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") as Status;
  if (!userId || !EDITABLE_STATUSES.includes(status)) return;
  if (userId === admin.id) return; // 본인 정지 금지
  await prisma.user.update({ where: { id: userId }, data: { status } });
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
}

// 회원 삭제 — 본인 제외. 발주 이력(+항목)도 함께 삭제(되돌릴 수 없음).
export async function deleteMemberAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === admin.id) return; // 본인 삭제 금지

  // 삭제 전 스냅샷(복구 참고용) — 회원 요약 + 함께 지워질 데이터 건수
  const victim = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, username: true, storeName: true, phone: true, address: true,
      role: true, status: true, payerNames: true, createdAt: true,
      _count: {
        select: {
          orders: true,
          invoices: true,
          weeklyOrders: true,
          reservationOrders: true,
        },
      },
    },
  });
  if (!victim) return; // 이미 없는 회원

  // 회원을 참조하는 모든 소유 데이터를 먼저 지워야 user.delete 가 FK 제약에 막히지 않는다.
  // (이전엔 발주(Order)만 지워, 계산서·주간발주·예약발주·재고담기가 있는 회원은 삭제가 실패했다.)
  // - Invoice/WeeklyOrder/ReservationOrder/Order: 각자의 항목(Item)은 onDelete:Cascade 로 함께 삭제.
  // - StockHold: 담기 홀드(임시).
  // - Notification/PushSubscription/ChatThread: User FK 가 Cascade 라 user.delete 시 자동 삭제.
  // - Deposit(matchedUserId): onDelete:SetNull — 실제 은행 입금 기록은 보존하고 매칭만 해제.
  await prisma.$transaction([
    prisma.invoice.deleteMany({ where: { userId } }),
    prisma.weeklyOrder.deleteMany({ where: { userId } }),
    prisma.reservationOrder.deleteMany({ where: { userId } }),
    prisma.stockHold.deleteMany({ where: { userId } }),
    prisma.order.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  await writeAudit({
    action: "member.delete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "user",
    targetId: userId,
    summary: `회원 삭제: ${victim.storeName}(${victim.username}) · 발주 ${victim._count.orders} · 계산서 ${victim._count.invoices} · 주간 ${victim._count.weeklyOrders} · 예약 ${victim._count.reservationOrders}건 함께 삭제`,
    snapshot: victim,
  });
  revalidatePath("/admin/members");
  redirect("/admin/members");
}

// 비밀번호 초기화(관리자가 새 비번 지정)
export async function resetMemberPasswordAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const pw = String(formData.get("password") ?? "");
  if (!userId) return { error: "잘못된 요청이에요." };
  if (pw.length < 4) return { error: "비밀번호는 4자 이상으로 정해주세요." };
  const passwordHash = await bcrypt.hash(pw, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  revalidatePath(`/admin/members/${userId}`);
  return { ok: true };
}

export async function approveUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!userId || !ASSIGNABLE_MERCHANT_ROLES.includes(role)) return;
  await prisma.user.update({
    where: { id: userId },
    data: { role, status: "APPROVED" },
  });
  await notifyMerchantSignupApproved(userId).catch(() => {}); // Q7
  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
}

export async function rejectUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { status: "REJECTED" },
  });
  await notifyMerchantSignupRejected(userId).catch(() => {}); // Q7
  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
}

const toInt = (v: FormDataEntryValue | null) =>
  parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10) || 0;

export async function addInventoryAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // #20 품목명 / 남은수량 / 공급가
  const qty = toInt(formData.get("qty"));
  const supplyPrice = toInt(formData.get("supplyPrice"));
  const memo = String(formData.get("memo") ?? "").trim();
  // 시트 동기화는 '품목명'을 키로 쓰므로 이름이 유일해야 한다. 같은 이름이 이미 있으면
  // 중복 생성 대신 그 품목을 갱신(재추가 = 수정). #22 리뷰(중복명 데이터 손실 방지)
  const dup = await prisma.inventoryItem.findFirst({
    where: { name, deletedAt: null },
    select: { id: true },
  });
  if (dup) {
    await prisma.inventoryItem.update({
      where: { id: dup.id },
      data: { qty, supplyPrice, ...(memo ? { memo } : {}) },
    });
  } else {
    const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
    await prisma.inventoryItem.create({
      data: { name, qty, supplyPrice, memo, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
  }
  await setInventoryPushPending(); // R3 변경 표시 → 다음 크론이 시트로 push(단방향)
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function updateInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim(); // #20 품목명도 수정
  const qty = toInt(formData.get("qty"));
  const supplyPrice = toInt(formData.get("supplyPrice"));
  await prisma.inventoryItem.update({
    where: { id },
    data: { ...(name ? { name } : {}), qty, supplyPrice },
  });
  await setInventoryPushPending(); // R3
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function deleteInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.inventoryItem.delete({ where: { id } });
  await setInventoryPushPending(); // R3
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

// 엑셀(스프레드시트) 붙여넣기 일괄 반영 — 앱이 기준(원본). 시트를 고치는 게 아니라 앱에 직접 넣는다.
// 3열: 품목명 / 수량 / 공급가. '엑셀 목록으로 전체 교체'(붙여넣기에 없는 기존 품목은 삭제).
// - 이름을 키로 upsert(기존 품목은 id를 보존 → 담기 원장 연결 유지). sortOrder는 붙여넣은 순서.
// - StockHold.itemId는 FK가 아니라 품목 삭제/교체에도 원장은 보존된다(이름 스냅샷).
// - ⚠️ 빈 목록이면 아무것도 하지 않는다(전량 삭제 사고 방지). 시트 반영은 pending만(단방향, 다음 크론).
export type BulkInventoryResult = {
  ok: boolean;
  error?: string;
  added?: number;
  updated?: number;
  deleted?: number;
};
export async function bulkReplaceInventoryAction(
  payloadJson: string,
): Promise<BulkInventoryResult> {
  const admin = await requireAdmin();

  let rows: { name?: string; qty?: unknown; supplyPrice?: unknown }[];
  try {
    rows = JSON.parse(String(payloadJson ?? "[]"));
  } catch {
    return { ok: false, error: "붙여넣은 내용을 읽지 못했어요. 다시 붙여넣어 주세요." };
  }
  if (!Array.isArray(rows)) return { ok: false, error: "형식이 올바르지 않아요." };

  // 문자/숫자 어느 쪽이 와도 안전하게 정수화
  const numOf = (v: unknown) => toInt(v == null ? null : String(v));
  // 정제 + 이름 기준 dedupe(첫 번째만 채택 — 이름이 동기화 키)
  const seen = new Set<string>();
  const clean: { name: string; qty: number; supplyPrice: number }[] = [];
  for (const r of rows) {
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    clean.push({ name, qty: numOf(r.qty), supplyPrice: numOf(r.supplyPrice) });
  }
  // 전량 삭제 사고 방지 — 빈 목록이면 거부(실수로 전체가 지워지는 것 차단)
  if (clean.length === 0) {
    return { ok: false, error: "붙여넣은 품목이 없어요. (안전을 위해 전체 삭제는 막았어요)" };
  }

  const current = await prisma.inventoryItem.findMany({
    select: { id: true, name: true },
  });
  const nameToId = new Map<string, string>();
  for (const it of current) if (!nameToId.has(it.name)) nameToId.set(it.name, it.id);

  const pastedNames = new Set(clean.map((c) => c.name));
  const keepIds = new Set<string>();
  for (const name of pastedNames) {
    const id = nameToId.get(name);
    if (id) keepIds.add(id);
  }
  // 삭제 대상: 붙여넣기에 없는 기존 품목 + 같은 이름 중복행(첫 id 외)
  const deleteRows = current.filter((it) => !keepIds.has(it.id));
  const deleteIds = deleteRows.map((it) => it.id);

  let added = 0;
  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      if (deleteIds.length) {
        await tx.inventoryItem.deleteMany({ where: { id: { in: deleteIds } } });
      }
      for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        const id = nameToId.get(c.name);
        if (id) {
          await tx.inventoryItem.update({
            where: { id },
            data: { qty: c.qty, supplyPrice: c.supplyPrice, sortOrder: i },
          });
          updated++;
        } else {
          await tx.inventoryItem.create({
            data: { name: c.name, qty: c.qty, supplyPrice: c.supplyPrice, sortOrder: i },
          });
          added++;
        }
      }
    },
    { timeout: 20000 },
  );

  await setInventoryPushPending(); // 단방향: 다음 크론이 시트로 반영
  await writeAudit({
    action: "inventory.bulkReplace",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "inventory",
    targetId: "",
    summary: `재고 일괄 교체: 갱신 ${updated} · 신규 ${added} · 삭제 ${deleteIds.length}`,
    snapshot: {
      added,
      updated,
      deletedCount: deleteIds.length,
      deletedNames: deleteRows.map((it) => it.name).slice(0, 300),
    },
  });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, added, updated, deleted: deleteIds.length };
}

// R4 재고 자동저장 — 편집기 입력을 디바운스로 계속 저장. 현재 목록으로 DB를 맞춘다(이름/수량/공급가
// 갱신 + 목록에서 빠진 항목 삭제). 시트 반영은 push하지 않고 'pending' 표시만 → 다음 크론이 반영(단방향).
export async function autosaveInventoryAction(payloadJson: string) {
  await requireAdmin();
  let rows: { id?: string; name?: string; qty?: unknown; supplyPrice?: unknown }[];
  try {
    rows = JSON.parse(String(payloadJson ?? "[]"));
  } catch {
    return; // 파싱 실패 시 아무것도 지우지 않음(전량 삭제 사고 방지)
  }
  if (!Array.isArray(rows)) return;

  const keepIds = rows.map((r) => String(r.id ?? "")).filter(Boolean);
  await prisma.$transaction(async (tx) => {
    // 편집기에서 제거된(목록에 없는) 항목 삭제
    await tx.inventoryItem.deleteMany({
      where: { id: { notIn: keepIds.length ? keepIds : ["__none__"] } },
    });
    for (const r of rows) {
      const id = String(r.id ?? "");
      if (!id) continue;
      const name = String(r.name ?? "").trim();
      await tx.inventoryItem.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          qty: toInt(String(r.qty ?? "")),
          supplyPrice: toInt(String(r.supplyPrice ?? "")),
        },
      });
    }
  });
  await setInventoryPushPending(); // R3 변경 표시 → 다음 크론이 시트로 push
  // 자동저장은 편집기 상태가 이미 정확하므로 /admin/inventory 재검증 생략(편집 중 리셋 방지).
  revalidatePath("/inventory");
}

// #22 관리자 수동 '지금 시트로 내보내기' — DB 전체를 시트에 다시 쓴다(정합 복구용). 성공/실패 반환.
export type PushInvState = { ok?: boolean; error?: string; at?: number };
export async function pushInventoryToSheetAction(
  _prev: PushInvState,
  _formData: FormData,
): Promise<PushInvState> {
  await requireAdmin();
  const r = await safePushInventory();
  revalidatePath("/admin/inventory");
  if (r.ok) return { ok: true, at: Date.now() };
  if (r.error === "no-credentials")
    return { ok: false, error: "구글 서비스계정이 설정되지 않았어요." };
  return { ok: false, error: "시트 반영에 실패했어요. 잠시 후 다시 시도해 주세요." };
}

// 전체 발주 초기화 — 관리자 전용. 모든 Order 삭제(OrderItem은 Cascade).
// 회원·재고는 유지. 실수 방지를 위해 확인 토큰 필요.
export async function resetAllOrdersAction(formData: FormData) {
  const admin = await requireAdmin();
  if (String(formData.get("confirm") ?? "") !== "RESET-ALL-ORDERS") return;
  const res = await prisma.order.deleteMany({});
  await writeAudit({
    action: "orders.resetAll",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "order",
    summary: `발주 전체 초기화 · ${res.count}건 삭제`,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/hotdeal");
  redirect(`/admin/orders?reset=${res.count}`);
}

// 지점 발주 전체 취소 — 관리자 전용. 해당 점주가 그 날짜에 넣은 발주(전 카테고리)를 CANCELLED로.
// 하드삭제가 아니라 status=CANCELLED로 남겨 양쪽에 '취소 완료'로 보이고, 잠겼던 발주창은 다시 열림.
// 계산서(미수)가 발행됐으면 취소 불가(먼저 VOID). 점주에게 '관리자에 의해 발주가 취소되었습니다' 푸시.
// useActionState로 결과를 반환(리다이렉트 X) — 모달이 결과를 받아 스스로 닫히게(재로딩 방지).
export type CancelOrdersState = { ok?: boolean; count?: number; error?: string };

export async function cancelStoreOrdersAction(
  _prev: CancelOrdersState,
  formData: FormData,
): Promise<CancelOrdersState> {
  const admin = await requireAdmin();
  if (String(formData.get("confirm") ?? "") !== "CANCEL-STORE-ORDERS") return {};
  const userId = String(formData.get("userId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!userId || !date) return {};

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target) return {};

  // 취소 범위: 가맹점(발주창 있음)은 '발주창 단위'로 지운다. 주말 연속창(토12시~일20시)은
  // KST 두 날짜에 걸쳐도 한 발주라 한 번에 취소(옛 버그#13: 하루만 지워 반쪽이 남아 채움채로 나감).
  // 소매·벤더(창 없음)는 종전대로 그 날짜 하루만.
  let start: Date;
  let end: Date;
  if (hasOrderWindow(target.role as Role)) {
    const noonMs = new Date(`${date}T12:00:00+09:00`).getTime();
    start = new Date(currentWindowStartUtc(noonMs));
    end = new Date(currentDeadlineUtc(noonMs));
  } else {
    ({ start, end } = kstDayRange(date));
  }
  // 취소 대상(아직 취소되지 않은 이 창의 발주)
  const targets = await prisma.order.findMany({
    where: { userId, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    select: { id: true, createdAt: true },
  });
  // 계산서(미수)가 발행됐으면 취소 불가 — 먼저 계산서 VOID 필요
  const invDates = [...new Set(targets.map((o) => kstDateOf(o.createdAt)))];
  if (invDates.length > 0) {
    const inv = await prisma.invoice.findFirst({
      where: { userId, kind: "DAILY", date: { in: invDates }, status: { in: ["ISSUED", "PAID"] } },
      select: { id: true },
    });
    if (inv) {
      return { error: "계산서가 발행되어 취소할 수 없어요. 먼저 계산서를 취소하세요." };
    }
  }
  // #2 하드삭제 — 취소한 발주는 완전 삭제(취소 완료로 남기지 않고 모든 목록·내역에서 제거).
  const res = await prisma.order.deleteMany({
    where: { id: { in: targets.map((o) => o.id) } },
  });
  if (res.count > 0) {
    await writeAudit({
      action: "orders.cancelStore",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "store",
      targetId: userId,
      summary: `지점 발주 삭제(취소) · ${date} · ${res.count}건`,
      snapshot: JSON.stringify({ orderIds: targets.map((o) => o.id), date }),
    });
    await notifyMerchantOrdersCancelled(userId);
  }

  revalidatePath("/admin/hotdeal");
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  revalidatePath(`/admin/combined/${userId}/${date}`);
  revalidatePath("/order");
  revalidatePath(`/order/day/${date}`);
  revalidatePath("/mypage");
  revalidatePath("/vendor");
  return { ok: true, count: res.count };
}
