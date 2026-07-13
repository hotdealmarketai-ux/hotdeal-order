"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { kstDayRange, kstDateOf } from "@/lib/date";
import { safePushInventory } from "@/lib/inventory-sheet";
import {
  currentWindowStartUtc,
  currentDeadlineUtc,
} from "@/lib/schedule";
import { hasOrderWindow } from "@/lib/deadline";
import { notifyMerchantOrdersCancelled } from "@/lib/push";
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

  // 삭제 전 스냅샷(복구 참고용) — 회원 요약 + 함께 지워질 발주 건수
  const victim = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, username: true, storeName: true, phone: true, address: true,
      role: true, status: true, payerNames: true, createdAt: true,
      _count: { select: { orders: true } },
    },
  });
  if (!victim) return; // 이미 없는 회원

  await prisma.$transaction([
    prisma.order.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  await writeAudit({
    action: "member.delete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "user",
    targetId: userId,
    summary: `회원 삭제: ${victim.storeName}(${victim.username}) · 발주 ${victim._count.orders}건 함께 삭제`,
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
  await safePushInventory(1); // #22 DB→시트 반영(1회 시도 — 실패 시 pending, 다음 pull이 재시도)
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
  await safePushInventory(1); // #22 DB→시트 반영(1회 시도 — 실패 시 pending, 다음 pull이 재시도)
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function deleteInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.inventoryItem.delete({ where: { id } });
  await safePushInventory(1); // #22 DB→시트 반영(삭제 전파, 1회 시도)
  revalidatePath("/admin/inventory");
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
    return { ok: false, error: "구글 서비스계정이 설정되지 않았어요(관리자 환경변수 필요)." };
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
