import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { ShipmentManager } from "@/components/ShipmentManager";

export const dynamic = "force-dynamic";

// 송장 관리 — 송장번호+택배사 등록 → 스마트택배 조회로 집하전/준비중/배송중/완료 4단계 자동 분류.
export default async function ShipmentsPage() {
  await requireAdmin();
  const shipments = await prisma.shipment.findMany({
    orderBy: [{ createdAt: "desc" }],
  });
  const rows = shipments.map((s) => ({
    id: s.id,
    trackingNo: s.trackingNo,
    courierCode: s.courierCode,
    courierName: s.courierName,
    itemName: s.itemName,
    qty: s.qty,
    status: s.status,
    statusText: s.statusText,
    lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
  }));

  return (
    <>
      <Topbar backHref="/admin" title="송장 관리" />
      <div className="page">
        <ShipmentManager shipments={rows} apiConfigured={!!process.env.SWEETTRACKER_API_KEY} />
      </div>
    </>
  );
}
