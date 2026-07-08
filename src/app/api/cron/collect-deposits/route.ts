import { collectDeposits } from "@/lib/bank";
import { logError } from "@/lib/log";

export const maxDuration = 60; // 팝빌 수집 대기 포함

// 입금 수집 크론 — GitHub Actions가 주기 호출. CRON_SECRET 보호.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const days = Math.min(
    14,
    Math.max(1, parseInt(url.searchParams.get("days") ?? "3", 10) || 3),
  );

  try {
    const result = await collectDeposits(days);
    return Response.json({ ok: result.errors.length === 0, ...result });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    // 키/사업자번호 미설정 = 아직 연동 전 → 크론을 실패로 울리지 않고 스킵 처리
    if (msg.includes("미설정")) {
      return Response.json({ ok: false, skipped: true, reason: msg });
    }
    logError("cron.bank.collect", err);
    return Response.json({ ok: false, error: msg }, { status: 500 });
  }
}
