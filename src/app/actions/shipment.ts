"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { courierName } from "@/lib/couriers";
import { trackShipment } from "@/lib/sweettracker";
import { refreshActiveShipments } from "@/lib/shipment";

const toInt = (v: unknown, min = 1) => {
  const n = Math.floor(Number(String(v ?? "").replace(/[^\d]/g, "")));
  return Number.isFinite(n) && n >= min ? n : min;
};

// 송장 등록 — 등록 즉시 1회 조회해 상태를 채운다(키 있으면).
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

  const t = await trackShipment(courierCode, trackingNo);
  const created = await prisma.shipment.create({
    data: {
      trackingNo,
      courierCode,
      courierName: courierName(courierCode),
      itemName,
      qty,
      status: t?.status ?? "PRE_PICKUP",
      statusText: t?.statusText ?? "",
      level: t?.level ?? 0,
      lastCheckedAt: t ? new Date() : null,
      deliveredAt: t?.delivered ? new Date() : null,
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

// 활성(배송완료 아님) 송장 전체 재조회 → 상태 갱신. 새로고침 버튼·페이지 진입 시 호출.
export async function refreshShipmentsAction(): Promise<{ ok: boolean; updated: number }> {
  await requireAdmin();
  const updated = await refreshActiveShipments();
  revalidatePath("/admin/shipments");
  return { ok: true, updated };
}
