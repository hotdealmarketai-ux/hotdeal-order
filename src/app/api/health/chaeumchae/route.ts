import { prisma } from "@/lib/prisma";

// 채움채 발주 전용 외부 헬스 체크(무인증) — UptimeRobot 등이 폴링해 503이면 알림.
// 목적: "오늘 채움채 발주가 안 들어감"을 8:10(KST) 전에 알려 바로 수기 대응할 수 있게 한다.
//  · 채움채 = 월·화·수·목·금·일 20:05(KST) 자동제출(토 제외). 유일 디스패처 cron-job.org → /api/cron/tick.
//  · 실사고는 대개 cron-job.org 가 몇 시간~며칠 전부터 죽어있는 형태(2026-07 2주 방치) → 20:05 까지
//    기다리지 말고 '제출 직전(19:50~)'에 하트비트로 크론 정지를 미리 감지 → 19:55 경 알림(8:10 훨씬 전).
// 판정:
//  · 채움채 날 아님(토) → 200
//  · [19:50, 20:07) 제출 직전 — tick 하트비트가 6분 넘게 멈췄으면 503(크론 정지 = 채움채 위험, 조기경보)
//  · [20:07, 24:00) 제출 후   — 오늘 채움채 제출 마커(tick:chaeumchae)가 오늘 목표(20:05) 이후로 안 찍혔으면 503
//  · 그 외 시간 → 200 (평상시 일반 크론 상태엔 관여 안 함 — 채움채에만 집중)
// 앱/Vercel 자체가 죽어 이 엔드포인트가 아예 안 뜨면 모니터가 connection-fail 로 잡으므로 그 경우도 커버.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KST = 9 * 60 * 60 * 1000;
const CHAEUMCHAE_DOWS = new Set([1, 2, 3, 4, 5, 0]); // 월화수목금일 (토=6 제외)
const TARGET_MIN = 20 * 60 + 5; // 20:05 제출 목표
const PREWIN_MIN = 19 * 60 + 50; // 19:50 제출 직전 감시 시작
const CHECK_MIN = 20 * 60 + 7; // 20:07 이후 실제 제출 여부 확정 판단
const PRE_STALE_MS = 6 * 60 * 1000; // 제출 직전 하트비트 6분 이상 멈춤 = 크론 정지

export async function GET() {
  const now = Date.now();
  const kst = new Date(now + KST);
  const dow = kst.getUTCDay();
  const y = kst.getUTCFullYear();
  const mo = kst.getUTCMonth();
  const da = kst.getUTCDate();
  const nostore = { "Cache-Control": "no-store" };

  // 채움채 발주가 없는 날(토요일) → 정상
  if (!CHAEUMCHAE_DOWS.has(dow)) {
    return Response.json({ ok: true, reason: "채움채 미발주일(토)", dow }, { headers: nostore });
  }

  const midUtc = Date.UTC(y, mo, da) - KST; // 오늘 KST 00:00 의 실제 UTC ms
  const targetUtc = midUtc + TARGET_MIN * 60000;
  const preUtc = midUtc + PREWIN_MIN * 60000;
  const checkUtc = midUtc + CHECK_MIN * 60000;

  try {
    // [19:50, 20:07) 제출 직전 — 크론(하트비트)이 살아있나? 죽어있으면 채움채가 안 나갈 것이므로 조기경보.
    if (now >= preUtc && now < checkUtc) {
      const hb = await prisma.appMeta.findUnique({ where: { key: "tick:heartbeat" } });
      const beat = hb?.syncedAt ? hb.syncedAt.getTime() : 0;
      const alive = beat > 0 && now - beat <= PRE_STALE_MS;
      return Response.json(
        { ok: alive, phase: "pre", lastBeat: hb?.syncedAt ?? null, dow },
        { status: alive ? 200 : 503, headers: nostore },
      );
    }

    // [20:07, 24:00) 제출 후 — 오늘 채움채가 실제로 나갔나? (마커가 오늘 20:05 이후로 갱신됐으면 정상)
    if (now >= checkUtc) {
      const m = await prisma.appMeta.findUnique({ where: { key: "tick:chaeumchae" } });
      const lastMs = m?.syncedAt ? m.syncedAt.getTime() : 0;
      const ran = lastMs >= targetUtc;
      return Response.json(
        { ok: ran, phase: "post", ran, lastRun: m?.syncedAt ?? null, dow },
        { status: ran ? 200 : 503, headers: nostore },
      );
    }

    // 제출 직전 창 이전 시간대 → 관여 안 함(정상)
    return Response.json({ ok: true, phase: "idle", dow }, { headers: nostore });
  } catch {
    // DB 오류 시엔 오탐 억제(경고 대신 정상 처리)
    return Response.json({ ok: true, dbError: true, dow }, { headers: nostore });
  }
}
