import { prisma } from "@/lib/prisma";
import { windowKeyAt } from "@/lib/schedule";

// 채움채 발주 전용 외부 헬스 체크(무인증) — UptimeRobot 등이 폴링해 503이면 알림.
// 목적: "오늘 채움채 발주가 안 들어감"을 8:10(KST) 전에 알려 바로 수기 대응할 수 있게 한다.
//  · 채움채 = 월·화·수·목·금·일 20:05(KST) 자동제출(토 제외). 디스패처 = cron-job.org → /api/cron/tick,
//    + 백업 = GitHub Actions(chaeumchae-submit, 20:05 재호출). 둘 다 submit-chaeumchae 를 부르고 발주창 claim 으로 멱등.
//  · 실사고는 대개 cron-job.org 가 몇 시간~며칠 전부터 죽어있는 형태(2026-07 2주 방치) → 20:05 까지
//    기다리지 말고 '제출 직전(19:50~)'에 하트비트로 크론 정지를 미리 감지 → 19:55 경 알림(8:10 훨씬 전).
// 판정:
//  · 채움채 날 아님(토) → 200
//  · [19:50, 20:07) 제출 직전 — tick 하트비트가 6분 넘게 멈췄으면 503(primary 크론 정지 = 채움채 위험, 조기경보)
//  · [20:07, 24:00) 제출 후   — 오늘 발주창의 제출 흔적이 없으면 503. 제출 흔적 = submit-chaeumchae 가 만든
//      claim 키 `chaeumchae:<windowKey>` (tick·GH Actions 어느 경로로 제출해도 생김) OR 발주없는날 done 마커.
//      → GH 백업이 대신 제출한 경우도 정상(200)으로 인식(경로 무관). 둘 다(=미제출/총실패 롤백) 없으면 503.
//  · 그 외 시간 → 200 (평상시 일반 크론 상태엔 관여 안 함 — 채움채에만 집중)
// 앱/Vercel 자체가 죽어 이 엔드포인트가 아예 안 뜨면 모니터가 connection-fail 로 잡으므로 그 경우도 커버.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KST = 9 * 60 * 60 * 1000;
const CHAEUMCHAE_DOWS = new Set([1, 2, 3, 4, 5, 0]); // 월화수목금일 (토=6 제외)
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
  const preUtc = midUtc + PREWIN_MIN * 60000;
  const checkUtc = midUtc + CHECK_MIN * 60000;

  try {
    // [19:50, 20:07) 제출 직전 — 크론(하트비트)이 살아있나? 죽어있으면 채움채가 안 나갈 위험이므로 조기경보.
    if (now >= preUtc && now < checkUtc) {
      const hb = await prisma.appMeta.findUnique({ where: { key: "tick:heartbeat" } });
      const beat = hb?.syncedAt ? hb.syncedAt.getTime() : 0;
      const alive = beat > 0 && now - beat <= PRE_STALE_MS;
      return Response.json(
        { ok: alive, phase: "pre", lastBeat: hb?.syncedAt ?? null, dow },
        { status: alive ? 200 : 503, headers: nostore },
      );
    }

    // [20:07, 24:00) 제출 후 — 오늘 발주창에 제출 흔적이 있나? (경로 무관: tick·GH Actions 어느 쪽이 제출해도 OK)
    if (now >= checkUtc) {
      const wk = windowKeyAt(now); // submit-chaeumchae 가 쓰는 것과 동일한 발주창 키
      const [claim, done] = await Promise.all([
        prisma.appMeta.findUnique({ where: { key: `chaeumchae:${wk}` } }), // 제출 시도(성공/부분) → 생김. 총실패면 롤백돼 없음.
        prisma.appMeta.findUnique({ where: { key: `chaeumchae:done:${wk}` } }), // 발주 없는 날 마커
      ]);
      const submitted = !!claim || !!done;
      return Response.json(
        { ok: submitted, phase: "post", submitted, windowKey: wk, dow },
        { status: submitted ? 200 : 503, headers: nostore },
      );
    }

    // 제출 직전 창 이전 시간대 → 관여 안 함(정상)
    return Response.json({ ok: true, phase: "idle", dow }, { headers: nostore });
  } catch {
    // DB 오류 시엔 오탐 억제(경고 대신 정상 처리)
    return Response.json({ ok: true, dbError: true, dow }, { headers: nostore });
  }
}
