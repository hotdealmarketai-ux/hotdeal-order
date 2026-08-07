import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { releaseStaleHolds } from "@/lib/stock-hold";
import { releaseClosedFlatHolds } from "@/lib/reservation-flat";

// 정시 크론 디스패처 — 외부 크론(cron-job.org 등)이 '1분마다' 이 엔드포인트를 호출하면,
// 각 잡을 정해진 KST 시각에 정확히 1회 실행한다. 한 분을 놓쳐도 다음 호출에서 캐치업.
// (GitHub Actions 스케줄이 부정확해서 도입. 외부 크론은 분 단위로 정확.)
export const maxDuration = 60; // 입금 수집(팝빌 대기) 포함될 수 있음

const KST = 9 * 60 * 60 * 1000;

function kstParts(atMs: number) {
  const d = new Date(atMs + KST);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    da: d.getUTCDate(),
    dow: d.getUTCDay(), // 0=일 ... 6=토
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
  };
}
function utcAt(y: number, mo: number, da: number, h: number, mi: number) {
  return Date.UTC(y, mo, da, h, mi, 0) - KST;
}

async function lastFired(key: string): Promise<number> {
  const m = await prisma.appMeta.findUnique({ where: { key } });
  return m ? m.syncedAt.getTime() : 0;
}
async function markFired(key: string, atMs: number) {
  const at = new Date(atMs);
  await prisma.appMeta.upsert({
    where: { key },
    create: { key, syncedAt: at },
    update: { syncedAt: at },
  });
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const origin = new URL(request.url).origin;
  const now = Date.now();
  const p = kstParts(now);
  const ran: string[] = [];

  // 기존 엔드포인트를 그대로 호출(로직 재사용, 헤더 인증). 엔드포인트들은 멱등이라 중복 안전.
  async function hit(path: string): Promise<boolean> {
    try {
      const r = await fetch(`${origin}${path}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      return r.ok;
    } catch (e) {
      logError("tick.hit", e, { path });
      return false;
    }
  }

  // 시각지정 잡: 오늘 target(KST)이 지났고 아직 안 쐈으면 1회 실행(성공 시 마킹).
  // graceMi: target 이후 이 시간(분)까지만 캐치업. 너무 늦으면 스킵(스테일 알림/잘못된 창 방지).
  async function timed(
    key: string,
    th: number,
    tmi: number,
    dows: number[],
    path: string,
    graceMi: number,
  ) {
    if (!dows.includes(p.dow)) return;
    const target = utcAt(p.y, p.mo, p.da, th, tmi);
    if (now < target) return; // 아직 시각 전
    if (now > target + graceMi * 60 * 1000) return; // 너무 늦음 → 스킵(다음 occurrence는 정상)
    if ((await lastFired(key)) >= target) return; // 이미 이 occurrence 실행함
    if (await hit(path)) {
      await markFired(key, now);
      ran.push(key);
    }
  }

  // 시간 민감 알림은 grace 짧게(늦으면 안 보냄), 채움채 제출은 3시간(같은 KST일 내), 연체 안내는 하루.
  // '발주 시작' 알림은 멱등이라 grace를 넉넉히(120분) — 디스패처가 크게 지연돼도 반드시 발송.
  // (마감·1시간전은 늦으면 오해라 30분 유지 — 늦은 마감 알림보다 미발송이 나음)
  await timed("tick:open", 12, 0, [1, 2, 3, 4, 5, 6], "/api/cron/notify?type=open", 120);
  await timed("tick:warn", 19, 0, [1, 2, 3, 4, 5, 0], "/api/cron/notify?type=warn", 30);
  await timed("tick:deadline", 20, 0, [1, 2, 3, 4, 5, 0], "/api/cron/notify?type=deadline", 30);
  await timed("tick:chaeumchae", 20, 5, [1, 2, 3, 4, 5, 0], "/api/cron/submit-chaeumchae", 180);
  await timed("tick:overdue", 10, 0, [0, 1, 2, 3, 4, 5, 6], "/api/cron/invoice-overdue?days=1", 720);
  // 상품 소싱 크롤 — 매일 아침 8시(로컬 업체 + 밀키트). 라우트가 트랙별 일일 dedup.
  await timed("tick:sourcing", 8, 0, [0, 1, 2, 3, 4, 5, 6], "/api/cron/sourcing", 720);
  // 창고 실물재고 동기화 — 매일 오전 10시(출고 끝난 시점, 재고=실물). 재고현황을 창고 수량 스냅샷으로.
  await timed("tick:wh-stock", 10, 0, [0, 1, 2, 3, 4, 5, 6], "/api/cron/warehouse-stock-sync", 720);

  // 주간발주 — 토요일(dow 6)만: 12시 오픈 / 19시 마감1h전 / 20시 마감
  await timed("tick:weekly-open", 12, 0, [6], "/api/cron/notify-weekly?type=open", 30);
  await timed("tick:weekly-warn", 19, 0, [6], "/api/cron/notify-weekly?type=warn", 30);
  await timed("tick:weekly-deadline", 20, 0, [6], "/api/cron/notify-weekly?type=deadline", 30);
  // 주간발주 미입금 안내 — 금요일(dow 5) 10시(토요일 마감 전날). 계산서당 1회(멱등).
  await timed("tick:weekly-overdue", 10, 0, [5], "/api/cron/weekly-overdue", 720);

  // 입금 자동수집 — 24시간, 약 10분 간격. 슬롯을 먼저 선점(팝빌 지연/타임아웃 나도 매분 재시도 방지).
  if (now - (await lastFired("tick:collect")) >= 9.5 * 60 * 1000) {
    await markFired("tick:collect", now);
    await hit("/api/cron/collect-deposits?days=3"); // 멱등 — 다음 슬롯에 다시 시도됨
    ran.push("tick:collect");
  }

  // 예약발주 상품 '마감 1시간 전' 리마인더 — 매 분 확인(창 진입 즉시 1회 발송, 라우트가 멱등).
  if (await hit("/api/cron/reservation-close-reminder")) ran.push("tick:resv-warn");

  // (송장 조회는 무료 한도(월 100건) 절약 위해 백그라운드 크론 없이 관리자 페이지 진입/새로고침 때만 수행)

  // #12 재고 구글시트 동기화 — 매 분(시트=기준). 실패해도 다음 분 재시도.
  if (await hit("/api/cron/inventory-sync")) ran.push("tick:inventory");

  // 재고 담기(HELD) 자동 해제 — 발주창 마감 시 미발주분 복구(발주분은 확정 시 이미 차감·삭제됨).
  try {
    const released = await releaseStaleHolds();
    if (released > 0) ran.push(`tick:holds(${released})`);
  } catch (e) {
    logError("tick.holds", e, {});
  }

  // 예약 flat 재고연동 '미확정' 홀드 해제 — 마감됐는데 발주확정 안 한 담기가 재고 가용을 계속 점유하는 누수 방지.
  try {
    const releasedFlat = await releaseClosedFlatHolds();
    if (releasedFlat > 0) ran.push(`tick:flat-holds(${releasedFlat})`);
  } catch (e) {
    logError("tick.flatHolds", e, {});
  }

  // (예약분 픽업10시 자동차감 제거 — 예약분은 계산서 발행 시 함께 차감됨)

  // ⚠ 공구 발주 마감(8시) 자동차감 폐지 — 재고 차감의 '유일 소스'는 계산서 발행(실제 출고 기준).
  //    담기발주·예약은 계산서에 불러와져 발행 시 차감됨(deductInvoiceStock). 발주 기준 자동차감은 이중차감이라 중단.

  return Response.json({
    ok: true,
    kst: `${p.h}:${String(p.mi).padStart(2, "0")}`,
    dow: p.dow,
    ran,
  });
}
