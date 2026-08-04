"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { courierName } from "@/lib/couriers";
import { refreshActiveShipments, type RefreshResult } from "@/lib/shipment";

const toInt = (v: unknown, min = 1) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n >= min ? n : min;
};

// 송장 등록 — PRE_PICKUP으로 만들고 refreshActiveShipments로 첫 조회(월 한도 카운터 포함).
export async function addShipmentAction(
  formData: FormData,
): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  const trackingNo = String(formData.get("trackingNo") ?? "")
    .replace(/[^\dA-Za-z-]/g, "")
    .trim();
  const courierCode = String(formData.get("courierCode") ?? "").trim();
  const itemName = String(formData.get("itemName") ?? "").trim().slice(0, 100);
  const qty = toInt(formData.get("qty"), 1);
  if (!trackingNo) return { error: "송장번호를 입력하세요." };
  if (!courierCode) return { error: "택배사를 선택하세요." };

  const created = await prisma.shipment.create({
    data: {
      trackingNo,
      courierCode,
      courierName: courierName(courierCode),
      itemName,
      qty,
      status: "PRE_PICKUP",
    },
    select: { id: true },
  });
  await writeAudit({
    action: "shipment.add",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "Shipment",
    targetId: created.id,
    summary: `송장 ${trackingNo}(${courierName(courierCode)}) 등록`,
  }).catch(() => {});
  // 등록 즉시 첫 조회(월 한도 내에서). 키 없거나 한도 도달이면 조용히 스킵.
  await refreshActiveShipments().catch(() => {});
  revalidatePath("/admin/shipments");
  return {};
}

export async function deleteShipmentAction(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.shipment.delete({ where: { id } }).catch(() => {});
  revalidatePath("/admin/shipments");
}

// 활성 송장 재조회(3시간 이상 안 조회된 것만) → 상태 갱신. 진입 시 자동 + 새로고침 버튼 공용.
export async function refreshShipmentsAction(): Promise<RefreshResult> {
  await requireAdmin();
  const r = await refreshActiveShipments();
  revalidatePath("/admin/shipments");
  return r;
}
