import { prisma } from "@/lib/prisma";
import { after } from "next/server";
import { logError } from "@/lib/log";
import { releaseStaleHolds } from "@/lib/stock-hold";
import { releaseClosedFlatHolds } from "@/lib/reservation-flat";

// 정시 크론 디스패처 — 외부 크론(cron-job.org 등)이 '1분마다' 이 엔드포인트를 호출하면,
// 각 잡을 정해진 KST 시각에 정확히 1회 실행한다. 한 분을 놓쳐도 다음 호출에서 캐치업.
//
// ⚡ 비차단(non-blocking) 디스패치: 인증 + 하트비트만 즉시 처리하고 응답을 바로 반환한 뒤,
//    실제 잡 실행(소싱 크롤=Firecrawl 수 분, 입금수집=팝빌 등 느린 것 포함)은 after()로 백그라운드에서 돌린다.
//    → 호출자(cron-job.org)는 항상 1초 내 200을 받으므로, 무거운 잡이 있어도 요청 timeout이 안 나고
//      cron-job.org가 잡을 '실패 누적'으로 자동 비활성화하는 사고(2026-07-27)가 재발하지 않는다.
//    (sub-job은 각자 별도 함수로 독립 실행되고, 대부분 멱등/일일 dedup이라 다음 분 재시도에도 안전.)
export const maxDuration = 60; // after() 백그라운드 실행 상한

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

  // 하트비트 — 응답 전에 동기로(빠름). 디스패처가 살아있음을 매 호출마다 기록(크론 정지 감지·경보용).
  await prisma.appMeta
    .upsert({
      where: { key: "tick:heartbeat" },
      create: { key: "tick:heartbeat", syncedAt: new Date(now) },
      update: { syncedAt: new Date(now) },
    })
    .catch((e) => logError("tick.heartbeat", e));

  // ── 실제 잡 디스패치는 응답 후 백그라운드(after)에서 — 응답을 절대 막지 않는다. ──
  after(async () => {
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

    // ── 시간 민감·가벼운 잡 먼저(느린 소싱보다 앞에 둬서, 60s 예산이 소진돼도 이것들은 반드시 실행) ──
    // '발주 시작' 알림은 멱등이라 grace 넉넉히(120분). 마감·1시간전은 늦으면 오해라 30분(늦은 알림보다 미발송).
    await timed("tick:open", 12, 0, [1, 2, 3, 4, 5, 6], "/api/cron/notify?type=open", 120);
    await timed("tick:warn", 19, 0, [1, 2, 3, 4, 5, 0], "/api/cron/notify?type=warn", 30);
    await timed("tick:deadline", 20, 0, [1, 2, 3, 4, 5, 0], "/api/cron/notify?type=deadline", 30);
    await timed("tick:chaeumchae", 20, 5, [1, 2, 3, 4, 5, 0], "/api/cron/submit-chaeumchae", 180);
    await timed("tick:overdue", 10, 0, [0, 1, 2, 3, 4, 5, 6], "/api/cron/invoice-overdue?days=1", 720);
    // 사내 메신저 — 오늘 캘린더 일정 아침 알림(08:00 KST 매일).
    await timed("tick:messenger-agenda", 8, 0, [0, 1, 2, 3, 4, 5, 6], "/api/cron/messenger-agenda", 720);
    await timed("tick:wh-stock", 10, 0, [0, 1, 2, 3, 4, 5, 6], "/api/cron/warehouse-stock-sync", 720);

    // 주간발주 — 토요일(dow 6)만: 12시 오픈 / 19시 마감1h전 / 20시 마감. 미입금 안내는 금요일(dow 5) 10시.
    await timed("tick:weekly-open", 12, 0, [6], "/api/cron/notify-weekly?type=open", 30);
    await timed("tick:weekly-warn", 19, 0, [6], "/api/cron/notify-weekly?type=warn", 30);
    await timed("tick:weekly-deadline", 20, 0, [6], "/api/cron/notify-weekly?type=deadline", 30);
    await timed("tick:weekly-overdue", 10, 0, [5], "/api/cron/weekly-overdue", 720);

    // 입금 자동수집 — 24시간, 약 10분 간격. 슬롯 먼저 선점(팝빌 지연/타임아웃 나도 매분 재시도 방지).
    if (now - (await lastFired("tick:collect")) >= 9.5 * 60 * 1000) {
      await markFired("tick:collect", now);
      await hit("/api/cron/collect-deposits?days=3"); // 멱등 — 다음 슬롯에 다시 시도됨
      ran.push("tick:collect");
    }

    // 매 분 확인(창 진입 즉시 1회 발송, 라우트가 멱등).
    if (await hit("/api/cron/reservation-close-reminder")) ran.push("tick:resv-warn");
    // #12 재고 구글시트 동기화 — 매 분(시트=기준). 실패해도 다음 분 재시도.
    if (await hit("/api/cron/inventory-sync")) ran.push("tick:inventory");

    // 재고 담기(HELD) 자동 해제 — 발주창 마감 시 미발주분 복구(발주분은 확정 시 이미 차감·삭제됨).
    try {
      const released = await releaseStaleHolds();
      if (released > 0) ran.push(`tick:holds(${released})`);
    } catch (e) {
      logError("tick.holds", e, {});
    }
    // 예약 flat 재고연동 '미확정' 홀드 해제 — 마감됐는데 발주확정 안 한 담기가 가용을 계속 점유하는 누수 방지.
    try {
      const releasedFlat = await releaseClosedFlatHolds();
      if (releasedFlat > 0) ran.push(`tick:flat-holds(${releasedFlat})`);
    } catch (e) {
      logError("tick.flatHolds", e, {});
    }

    // ── 무거운 소싱 크롤(Firecrawl 수 분)은 맨 마지막에 — 60s 예산을 넘겨 잘려도 위 잡들은 이미 실행됨.
    //    (소싱은 라우트가 일일 dedup이라 다음 분 tick이 재호출해도 중복 크롤 없이 빠르게 완료·마킹됨.)
    await timed("tick:sourcing-local", 8, 30, [1, 2, 3, 4, 5, 6], "/api/cron/sourcing?track=local", 720);
    await timed("tick:sourcing-mealkit", 8, 30, [1], "/api/cron/sourcing?track=mealkit", 720);

    if (ran.length) {
      console.log(`[tick] ${p.h}:${String(p.mi).padStart(2, "0")} ran: ${ran.join(", ")}`);
    }
  });

  // 즉시 응답 — 무거운 잡을 기다리지 않는다(호출자 timeout 방지). 실제 실행은 위 after()가 담당.
  return Response.json({
    ok: true,
    scheduled: true,
    kst: `${p.h}:${String(p.mi).padStart(2, "0")}`,
    dow: p.dow,
  });
}
