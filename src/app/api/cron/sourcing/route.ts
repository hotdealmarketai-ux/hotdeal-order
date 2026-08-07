// 매일 아침 소싱 크롤 — 로컬 업체(Track A) + 밀키트(Track B) 수집·선별.
// 일일 1회 dedup(AppMeta claim) — Firecrawl 등 유료 크롤 비용 낭비/중복 실행 방지. ?force=1로 수동 재실행.
import { runLocalSourcing, runMealkitSourcing } from "@/lib/sourcing/engine";
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";
import { logError } from "@/lib/log";

export const maxDuration = 300; // 크롤 여유(플랜 한도까지). 켜진 어댑터에 따라 실제 소요는 가변.

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  const url = new URL(request.url);
  const track = (url.searchParams.get("track") || "all").toLowerCase(); // all | local | mealkit
  const force = url.searchParams.get("force") === "1";
  const today = kstDateOf(new Date());

  const wantLocal = track === "all" || track === "local";
  const wantKit = track === "all" || track === "mealkit";

  // 일일 dedup(트랙별) — 이미 오늘 돌았으면 스킵(수동 force 제외).
  async function claim(t: string): Promise<boolean> {
    if (force) return true;
    try {
      await prisma.appMeta.create({ data: { key: `sourcing:${today}:${t}` } });
      return true;
    } catch {
      return false; // 이미 claim됨
    }
  }

  const result: Record<string, unknown> = { today };
  try {
    if (wantLocal && (await claim("local"))) {
      result.local = await runLocalSourcing();
    } else if (wantLocal) {
      result.local = { dedup: true };
    }
    if (wantKit && (await claim("mealkit"))) {
      result.mealkit = await runMealkitSourcing();
    } else if (wantKit) {
      result.mealkit = { dedup: true };
    }
    return Response.json({ ok: true, ...result });
  } catch (err) {
    logError("cron.sourcing", err, { track });
    return Response.json({ ok: false, error: String(err), ...result }, { status: 500 });
  }
}
