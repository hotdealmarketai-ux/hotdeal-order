"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireVendor } from "@/lib/session";

export async function confirmOrderAction(formData: FormData) {
  const user = await requireVendor();
  const orderId = String(formData.get("orderId") ?? "");
  const next = String(formData.get("next") ?? "true") === "true";
  if (!orderId) return;

  // 본인(업자)에게 온 발주만 확인 가능
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { vendorRole: true },
  });
  if (!order || order.vendorRole !== user.role) return;

  await prisma.order.update({
    where: { id: orderId },
    data: { confirmed: next, confirmedAt: next ? new Date() : null },
  });
  revalidatePath("/vendor");
  revalidatePath(`/vendor/${orderId}`);
}
