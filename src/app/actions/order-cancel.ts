"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireMerchant, requireAdmin } from "@/lib/session";
import { windowKeyAt } from "@/lib/schedule";
import { kstDateOf, shipmentDayOf } from "@/lib/date";
import { writeAudit } from "@/lib/audit";
import {
  notifyAdminOrderCancelRequest,
  notifyMerchantCancelApproved,
  notifyMerchantCancelRejected,
} from "@/lib/push";
import { restoreStockForOrder } from "@/lib/stock-hold";
import { lockStore, syncPlanHolds, windowOrdersWhere } from "@/lib/order-plan";

// 발행된 계산서(미수)가 있으면 취소 불가 — 해당 '출고일'(들)의 DAILY ISSUED/PAID 존재 여부.
// (계산서가 발행되면 이미 청구/출고 기준이 잡힌 것 → 관리자가 먼저 계산서를 VOID해야 취소 가능)
// ⚠ dates는 발주의 '출고일'(shipmentDayOf) 목록 — Invoice.date가 출고일 기준이라 발주일로 넘기면 오작동.
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

  // 발주 화면('발주 수정하러 가기'·이 버튼이 뜨는 기준)과 createOrderAction 중복 검사와 같은 기준 =
  // 발주창 키 묶음(windowOrdersWhere). 주말 토·일, 강제오픈·지점 '발주 시간 열기'로 정오 전에 넣은
  // 발주도 같은 창으로 잡는다(기준이 다르면 버튼은 떴는데 0건이라 조용히 돌아가 먹통이 된다).
  const orders = await prisma.order.findMany({
    where: windowOrdersWhere(user.id, windowKeyAt()),
    select: { id: true, createdAt: true },
  });
  if (orders.length === 0) redirect("/order");

  const dates = [...new Set(orders.map((o) => shipmentDayOf(kstDateOf(o.createdAt))))];
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

  const dates = [...new Set(orders.map((o) => shipmentDayOf(kstDateOf(o.createdAt))))];
  if (await hasIssuedInvoice(userId, dates)) redirect("/admin/hotdeal?cancelErr=invoiced");

  // 삭제 전 — 공구(TOOL) 담기분 기준재고 복구(취소=출고 안 함). 재고조사가 최종 정합.
  for (const o of orders) {
    await restoreStockForOrder(o.id).catch(() => {});
  }
  // #2 하드삭제 — 취소 승인 시 CANCELLED로 남기지 않고 완전 삭제(모든 목록·내역에서 사라짐).
  // 삭제 요약은 감사로그 snapshot에 남겨 사후 확인 가능.
  // 같은 트랜잭션에서 이 지점의 이번 창 '연동 공구 발주분' 담기원장(PLAN)도 다시 맞춘다
  // (안 하면 지운 발주의 홀드가 20시까지 남아 다른 지점 남은 수량을 깎는다).
  await prisma.$transaction(async (tx) => {
    await lockStore(tx, userId);
    await tx.order.deleteMany({
      where: { id: { in: orders.map((o) => o.id) } },
    });
    await syncPlanHolds(tx, userId, windowKeyAt());
  }, { timeout: 10_000 });
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
