import { getCronHealth } from "@/lib/cron-health";

// 외부 uptime 모니터용 공개 헬스 체크(인증 불필요) — 자동화(크론)가 살아있으면 200, 멈췄으면 503.
// UptimeRobot·cron-job.org 등에서 이 URL을 폴링해 503/다운이면 알림 → 외부 크론(SPOF) 밖에서
// "자동화가 조용히 멈춤"을 즉시 감지한다(2026-07 처럼 2주간 방치되는 것 방지).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const h = await getCronHealth();
  return Response.json(
    { ok: h.ok, staleMinutes: h.staleMinutes, lastBeat: h.lastBeat },
    { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
