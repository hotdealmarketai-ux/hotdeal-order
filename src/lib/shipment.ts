// 송장 상태 갱신 — 배송완료 아닌 송장을 스마트택배로 재조회해 status 캐시 업데이트.
// 관리자 새로고침 액션 + tick 크론이 공용으로 호출(auth 없음 — 호출측이 인증 담당).
import { prisma } from "@/lib/prisma";
import { trackShipment } from "@/lib/sweettracker";

export async function refreshActiveShipments(): Promise<number> {
  const actives = await prisma.shipment.findMany({
    where: { status: { not: "DELIVERED" } },
    select: { id: true, courierCode: true, trackingNo: true },
  });
  let updated = 0;
  // 순차 조회(무료 API rate limit 배려 — 활성 송장은 소수).
  for (const s of actives) {
    const t = await trackShipment(s.courierCode, s.trackingNo);
    if (!t) continue; // 키 미설정
    await prisma.shipment.update({
      where: { id: s.id },
      data: {
        status: t.status,
        statusText: t.statusText,
        level: t.level,
        lastCheckedAt: new Date(),
        deliveredAt: t.delivered ? new Date() : null,
      },
    });
    updated++;
  }
  return updated;
}
