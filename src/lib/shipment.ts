// 송장 상태 갱신 — 스마트택배 무료 플랜(월 100건, 송장당 일 10회) 한도를 아끼는 절약형 조회.
//  · 송장별 최소 재조회 간격 3시간 → 하루 최대 8회/송장(< 10회/일 한도).
//  · 월 조회 카운터(AppMeta) 95건에서 중단 → 무료 한도(100) 초과 방지.
//  · 백그라운드 크론 없음 — 관리자가 페이지를 볼 때(진입/새로고침)만 조회.
import { prisma } from "@/lib/prisma";
import { trackShipment } from "@/lib/sweettracker";

const KST = 9 * 60 * 60 * 1000;
export const MONTHLY_CAP = 95; // 무료 100건 - 여유 5
export const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 송장별 최소 재조회 간격 3시간

function monthKey(now: number): string {
  return `sweettracker:count:${new Date(now + KST).toISOString().slice(0, 7)}`; // YYYY-MM(KST)
}

async function readUsed(key: string): Promise<number> {
  const m = await prisma.appMeta.findUnique({ where: { key } });
  return m ? parseInt(m.value || "0", 10) || 0 : 0;
}

export async function getMonthlyUsage(
  now: number = Date.now(),
): Promise<{ used: number; remaining: number; cap: number }> {
  const used = await readUsed(monthKey(now));
  return { used, remaining: Math.max(0, MONTHLY_CAP - used), cap: MONTHLY_CAP };
}

export type RefreshResult = {
  updated: number;
  used: number;
  remaining: number;
  capped: boolean;
  hadKey: boolean;
};

// 활성(배송완료 아님) 송장 중 '3시간 이상 안 조회된' 것만 재조회. 월 한도 도달 시 중단.
export async function refreshActiveShipments(
  now: number = Date.now(),
): Promise<RefreshResult> {
  const key = monthKey(now);
  let used = await readUsed(key);
  if (used >= MONTHLY_CAP) {
    return { updated: 0, used, remaining: 0, capped: true, hadKey: true };
  }

  const actives = await prisma.shipment.findMany({
    where: { status: { not: "DELIVERED" } },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } }, // 안 조회된 것·오래된 것 먼저
    select: { id: true, courierCode: true, trackingNo: true, lastCheckedAt: true },
  });

  let updated = 0;
  let hadKey = true;
  for (const s of actives) {
    if (used >= MONTHLY_CAP) break;
    if (s.lastCheckedAt && now - s.lastCheckedAt.getTime() < REFRESH_INTERVAL_MS) continue; // 최근 조회 → 스킵
    const t = await trackShipment(s.courierCode, s.trackingNo);
    if (!t) {
      hadKey = false; // 키 미설정 → 더 돌 필요 없음
      break;
    }
    used += 1;
    updated += 1;
    await prisma.shipment.update({
      where: { id: s.id },
      data: {
        status: t.status,
        statusText: t.statusText,
        level: t.level,
        lastCheckedAt: new Date(now),
        deliveredAt: t.delivered ? new Date(now) : null,
      },
    });
  }

  if (updated > 0) {
    await prisma.appMeta.upsert({
      where: { key },
      create: { key, value: String(used), syncedAt: new Date(now) },
      update: { value: String(used), syncedAt: new Date(now) },
    });
  }
  return { updated, used, remaining: Math.max(0, MONTHLY_CAP - used), capped: used >= MONTHLY_CAP, hadKey };
}
