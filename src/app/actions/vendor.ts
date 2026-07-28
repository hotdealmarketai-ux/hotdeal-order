"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireVendor } from "@/lib/session";
import { VENDOR_LABEL, type Role } from "@/lib/constants";
import { orderRangeForShipment, normalizeDateStr } from "@/lib/date";
import { notifyMerchantOrderConfirmed } from "@/lib/push";

export async function confirmOrderAction(formData: FormData) {
  const user = await requireVendor();
  const orderId = String(formData.get("orderId") ?? "");
  const next = String(formData.get("next") ?? "true") === "true";
  if (!orderId) return;

  // 본인(업자)에게 온 발주만 확인 가능. 새롭 본사는 공구+채움채(본사 출고분) 확인 가능.
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { vendorRole: true, userId: true, status: true },
  });
  const allowedRoles =
    user.role === "ADMIN_SAEROP"
      ? ["ADMIN_SAEROP", "VENDOR_CHAEUMCHAE"]
      : [user.role];
  if (
    !order ||
    !allowedRoles.includes(order.vendorRole) ||
    order.status === "CANCELLED"
  )
    return;

  await prisma.order.update({
    where: { id: orderId },
    data: { confirmed: next, confirmedAt: next ? new Date() : null },
  });

  // 발주 확인 시(취소는 제외) 점주에게 알림
  if (next) {
    const label = VENDOR_LABEL[user.role as Role] ?? user.storeName;
    await notifyMerchantOrderConfirmed(order.userId, label);
  }

  revalidatePath("/vendor");
  revalidatePath(`/vendor/${orderId}`);
}

// 본사 출고(새롭) 지점 통합 발주서 — 그 지점의 공구+채움채 발주를 한 번에 확인/해제.
export async function confirmStoreShipmentAction(formData: FormData) {
  const user = await requireVendor();
  if (user.role !== "ADMIN_SAEROP") return; // 본사 출고 전용
  const userId = String(formData.get("userId") ?? "");
  const date = normalizeDateStr(String(formData.get("date") ?? ""));
  const next = String(formData.get("next") ?? "true") === "true";
  if (!userId) return;

  const { start, end } = orderRangeForShipment(date);
  const orders = await prisma.order.findMany({
    where: {
      userId,
      vendorRole: { in: ["ADMIN_SAEROP", "VENDOR_CHAEUMCHAE"] },
      createdAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });
  if (orders.length === 0) return;

  await prisma.order.updateMany({
    where: { id: { in: orders.map((o) => o.id) } },
    data: { confirmed: next, confirmedAt: next ? new Date() : null },
  });

  if (next) {
    await notifyMerchantOrderConfirmed(userId, "새롭 본사 출고");
  }

  revalidatePath("/vendor");
  revalidatePath(`/vendor/store/${userId}`);
}
