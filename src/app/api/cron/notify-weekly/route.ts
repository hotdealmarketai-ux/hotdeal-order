import { sendPushToRole } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";

// 주간발주(항시품목) 예약 알림 — 핫딜마켓 가맹점 대상. 매주 '토요일'만.
//  12:00 오픈 / 19:00 마감 1시간 전 / 20:00 마감.
const KST = 9 * 60 * 60 * 1000;
const WEEKLY_DOW = 6; // 토요일

function kstParts(atMs: number) {
  const d = new Date(atMs + KST);
  return { dow: d.getUTCDay(), h: d.getUTCHours() };
}

type Job = { type: string; title: string };

const JOBS: Record<string, Job> = {
  open: { type: "open", title: "지금부터 주간발주가 가능합니다." },
  warn: { type: "warn", title: "주간발주 마감 1시간 전 입니다." },
  deadline: { type: "deadline", title: "주간발주가 마감되었습니다." },
};

function pick(dow: number, h: number): Job | null {
  if (dow !== WEEKLY_DOW) return null;
  if (h === 12) return JOBS.open;
  if (h === 19) return JOBS.warn;
  if (h === 20) return JOBS.deadline;
  return null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const typeParam = url.searchParams.get("type");
  const atParam = url.searchParams.get("at");
  const atMs = atParam ? new Date(atParam).getTime() : Date.now();
  const { dow, h } = kstParts(atMs);

  // ?type= 이 와도 토요일에만 발송(잘못된 요일 방지)
  const job = typeParam ? (dow === WEEKLY_DOW ? JOBS[typeParam] : null) : pick(dow, h);
  if (!job) return Response.json({ ok: true, sent: false, dow, h });

  const key = `notify-weekly:${job.type}:${kstDateOf(new Date(atMs))}`;
  const already = await prisma.appMeta.findUnique({ where: { key } });
  if (already) {
    return Response.json({ ok: true, sent: false, dedup: true, type: job.type });
  }

  await sendPushToRole("MERCHANT_HOTDEAL", {
    title: job.title,
    body: "",
    url: "/weekly",
  });
  await prisma.appMeta.upsert({
    where: { key },
    create: { key, syncedAt: new Date() },
    update: { syncedAt: new Date() },
  });
  return Response.json({ ok: true, sent: true, type: job.type, dow, h });
}
