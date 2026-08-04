// 송장 상태 갱신 — 스마트택배 무료 플랜(월 100건, 송장당 일 10회) 한도를 아끼는 절약형 조회.
//  · 무료 한도의 "월 100건"은 총 API 호출이 아니라 '서로 다른 송장 100개/월'.
//    한 송장을 여러 번 재조회하는 것은 한도에 쌓이지 않으므로, 카운터는 '이번 달 처음 조회한 송장 수'만 센다.
//  · 송장별 최소 재조회 간격 3시간 → 하루 최대 8회/송장(< 10회/일 재조회 한도).
//  · 월 한도(서로 다른 송장) 도달 시: '새 송장'은 조회를 미루고, 이미 이번 달에 잡힌 송장은 계속 갱신.
//  · 백그라운드 크론 없음 — 관리자가 페이지를 볼 때(진입/새로고침)만 조회.
import { prisma } from "@/lib/prisma";
import { trackShipment } from "@/lib/sweettracker";

const KST = 9 * 60 * 60 * 1000;
export const MONTHLY_CAP = 95; // 서로 다른 송장 100개/월 - 여유 5
export const REFRESH_INTERVAL_MS = 3 * 60 * 60 * 1000; // 송장별 최소 재조회 간격 3시간

function monthOf(now: number): string {
  return new Date(now + KST).toISOString().slice(0, 7); // YYYY-MM(KST)
}
function counterKey(ym: string): string {
  return `sweettracker:count:${ym}`; // 이번 달 서로 다른 송장 수
}

async function readUsed(key: string): Promise<number> {
  const m = await prisma.appMeta.findUnique({ where: { key } });
  return m ? parseInt(m.value || "0", 10) || 0 : 0;
}

export async function getMonthlyUsage(
  now: number = Date.now(),
): Promise<{ used: number; remaining: number; cap: number }> {
  const used = await readUsed(counterKey(monthOf(now)));
  return { used, remaining: Math.max(0, MONTHLY_CAP - used), cap: MONTHLY_CAP };
}

export type RefreshResult = {
  updated: number;
  used: number; // 이번 달 서로 다른 송장 수
  remaining: number;
  capped: boolean; // 새 송장 한도 도달(기존 송장 갱신은 계속됨)
  hadKey: boolean;
};

// 활성(배송완료 아님) 송장 중 '3시간 이상 안 조회된' 것만 재조회.
// 이번 달 처음 잡는 송장은 월 카운터를 올리고, 한도 도달 시 '새 송장'만 건너뛴다(기존 송장 재조회는 계속).
export async function refreshActiveShipments(
  now: number = Date.now(),
): Promise<RefreshResult> {
  const ym = monthOf(now);
  const key = counterKey(ym);
  let used = await readUsed(key);

  const actives = await prisma.shipment.findMany({
    where: { status: { not: "DELIVERED" } },
    // 이미 이번 달에 잡힌 송장(재조회, 한도 무관)을 먼저 갱신 → 새 송장은 남는 한도로.
    orderBy: [
      { lastQueryMonth: "desc" }, // 이번 달치("YYYY-MM")가 위로, 빈값("")은 아래로
      { lastCheckedAt: { sort: "asc", nulls: "first" } },
    ],
    select: {
      id: true,
      courierCode: true,
      trackingNo: true,
      lastCheckedAt: true,
      lastQueryMonth: true,
    },
  });

  let updated = 0;
  let capped = false;
  let hadKey = true;
  for (const s of actives) {
    if (s.lastCheckedAt && now - s.lastCheckedAt.getTime() < REFRESH_INTERVAL_MS) continue; // 최근 3시간 → 스킵
    const isNew = s.lastQueryMonth !== ym; // 이번 달 처음 잡는 송장?
    if (isNew && used >= MONTHLY_CAP) {
      capped = true; // 새 송장은 이번 달 한도 초과 → 다음 달까지 대기(기존 송장은 계속 갱신)
      continue;
    }
    const t = await trackShipment(s.courierCode, s.trackingNo);
    if (!t) {
      hadKey = false; // 키 미설정 → 더 돌 필요 없음
      break;
    }
    if (isNew) used += 1;
    updated += 1;
    await prisma.shipment.update({
      where: { id: s.id },
      data: {
        status: t.status,
        statusText: t.statusText,
        level: t.level,
        lastCheckedAt: new Date(now),
        deliveredAt: t.delivered ? new Date(now) : null,
        ...(isNew ? { lastQueryMonth: ym } : {}),
      },
    });
  }

  await prisma.appMeta.upsert({
    where: { key },
    create: { key, value: String(used), syncedAt: new Date(now) },
    update: { value: String(used), syncedAt: new Date(now) },
  });
  return { updated, used, remaining: Math.max(0, MONTHLY_CAP - used), capped, hadKey };
}
