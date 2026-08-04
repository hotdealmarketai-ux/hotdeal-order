// 스마트택배(SweetTracker) 통합 택배 조회 — 서버 전용(fetch + API 키).
// 무료 키를 env SWEETTRACKER_API_KEY 에 넣으면 작동. 키 없으면 null(호출측이 미조회로 둠).
// 상태 매핑(level): 0~1/미등록 → 집하전, 2(집화완료) → 배송준비중, 3~5 → 배송중, 6/complete → 배송완료.
import type { ShipmentStatus } from "@/lib/couriers";
import { logError } from "@/lib/log";

export type TrackResult = {
  status: ShipmentStatus;
  statusText: string; // 마지막 상세(예: "배송출발")
  level: number;
  delivered: boolean;
};

function bucketFromLevel(level: number, complete: boolean): ShipmentStatus {
  if (complete || level >= 6) return "DELIVERED";
  if (level >= 3) return "IN_TRANSIT"; // 배송중·지점도착·배송출발
  if (level === 2) return "READY"; // 집화완료 → 배송 준비중
  return "PRE_PICKUP"; // level ≤ 1 → 집하전
}

// 송장 1건 조회. 키 없으면 null. 네트워크/파싱 오류는 ERROR로.
export async function trackShipment(
  courierCode: string,
  trackingNo: string,
): Promise<TrackResult | null> {
  const key = process.env.SWEETTRACKER_API_KEY;
  if (!key) return null; // 키 미설정 → 조회 스킵
  const url =
    `https://info.sweettracker.co.kr/api/v1/trackingInfo` +
    `?t_key=${encodeURIComponent(key)}` +
    `&t_code=${encodeURIComponent(courierCode)}` +
    `&t_invoice=${encodeURIComponent(trackingNo)}`;
  try {
    const r = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const j: any = await r.json();
    const details: unknown[] = Array.isArray(j?.trackingDetails) ? j.trackingDetails : [];

    // 오류/미등록 응답: { status:false, msg } 또는 { code, message } (배송조회 결과 없음 = 아직 집하 전)
    if ((j?.status === false || j?.code) && details.length === 0) {
      const msg = String(j?.msg ?? j?.message ?? "");
      if (/없|미등록|not\s*found|no\s*result/i.test(msg) || !msg) {
        return { status: "PRE_PICKUP", statusText: "집하 전(미등록)", level: 0, delivered: false };
      }
      return { status: "ERROR", statusText: msg.slice(0, 60), level: 0, delivered: false };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const last: any = details.length ? details[details.length - 1] : null;
    const level = Math.floor(Number(j?.level ?? last?.level ?? 0)) || 0;
    const complete = j?.complete === true || level >= 6;
    if (details.length === 0 && !complete) {
      return { status: "PRE_PICKUP", statusText: "집하 전(미등록)", level: 0, delivered: false };
    }
    const statusText = String(last?.kind ?? j?.lastStateDetail ?? "").slice(0, 60);
    return {
      status: bucketFromLevel(level, complete),
      statusText,
      level,
      delivered: complete,
    };
  } catch (err) {
    logError("sweettracker.track", err, { courierCode, trackingNo });
    return { status: "ERROR", statusText: "조회 오류", level: 0, delivered: false };
  }
}
