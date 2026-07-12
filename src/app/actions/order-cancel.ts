"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMerchant, requireAdmin } from "@/lib/session";
import { currentWindowStartUtc, currentDeadlineUtc } from "@/lib/schedule";
import { kstDateOf } from "@/lib/date";
import { writeAudit } from "@/lib/audit";
import {
  notifyAdminOrderCancelRequest,
  notifyMerchantCancelApproved,
  notifyMerchantCancelRejected,
} from "@/lib/push";

// 발행된 계산서(미수)가 있으면 취소 불가 — 해당 날짜(들)의 DAILY ISSUED/PAID 존재 여부.
// (계산서가 발행되면 이미 청구/출고 기준이 잡힌 것 → 관리자가 먼저 계산서를 VOID해야 취소 가능)
async function hasIssuedInvoice(userId: string, dates: string[]): Promise<boolean> {
  if (dates.length === 0) return false;
  const inv = await prisma.invoice.findFirst({
    where: {
      userId,
      kind: "DAILY",
      date: { in: dates },
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  return !!inv;
}

// 점주: 이번 발주창 발주에 '취소 요청' 표시 + 관리자 알림. 실제 취소는 관리자 승인 시.
export async function requestCancelOrderAction(formData: FormData) {
  const user = await requireMerchant();
  if (String(formData.get("confirm") ?? "") !== "REQUEST-CANCEL") redirect("/order");

  const start = new Date(currentWindowStartUtc());
  const end = new Date(currentDeadlineUtc());
  const orders = await prisma.order.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
    },
    select: { id: true, createdAt: true },
  });
  if (orders.length === 0) redirect("/order");

  const dates = [...new Set(orders.map((o) => kstDateOf(o.createdAt)))];
  if (await hasIssuedInvoice(user.id, dates)) redirect("/order?cancelErr=invoiced");

  await prisma.order.updateMany({
    where: { id: { in: orders.map((o) => o.id) } },
    data: { cancelRequested: true, cancelRequestedAt: new Date() },
  });
  await notifyAdminOrderCancelRequest(user.storeName).catch(() => {});
  redirect("/order?cancelReq=1");
}

// 관리자: 취소 요청 승인 → status=CANCELLED + 점주에게 '취소 요청 승인 완료' 알림
export async function approveCancelRequestAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) redirect("/admin/hotdeal");

  const orders = await prisma.order.findMany({
    where: { userId, cancelRequested: true, status: { not: "CANCELLED" } },
    select: { id: true, createdAt: true },
  });
  if (orders.length === 0) redirect("/admin/hotdeal");

  const dates = [...new Set(orders.map((o) => kstDateOf(o.createdAt)))];
  if (await hasIssuedInvoice(userId, dates)) redirect("/admin/hotdeal?cancelErr=invoiced");

  // #2 하드삭제 — 취소 승인 시 CANCELLED로 남기지 않고 완전 삭제(모든 목록·내역에서 사라짐).
  // 삭제 요약은 감사로그 snapshot에 남겨 사후 확인 가능.
  await prisma.order.deleteMany({
    where: { id: { in: orders.map((o) => o.id) } },
  });
  const store = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeName: true },
  });
  await writeAudit({
    action: "orders.cancelApprove",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "store",
    targetId: userId,
    summary: `${store?.storeName ?? ""} 발주 취소요청 승인(삭제) · ${orders.length}건`,
    snapshot: JSON.stringify({ orderIds: orders.map((o) => o.id), dates }),
  });
  await notifyMerchantCancelApproved(userId).catch(() => {});
  redirect("/admin/hotdeal");
}

// 관리자: 취소 요청 반려 → cancelRequested 해제 + 점주에게 반려 알림
export async function rejectCancelRequestAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) redirect("/admin/hotdeal");

  const res = await prisma.order.updateMany({
    where: { userId, cancelRequested: true },
    data: { cancelRequested: false },
  });
  if (res.count > 0) {
    await writeAudit({
      action: "orders.cancelReject",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "store",
      targetId: userId,
      summary: "발주 취소요청 반려",
    });
    await notifyMerchantCancelRejected(userId).catch(() => {});
  }
  redirect("/admin/hotdeal");
}
