import { sendPushToRole } from "@/lib/push";
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";

// 핫딜마켓 가맹점 대상 예약 알림.
// 마감(20시)이 있는 날 = 월·화·수·목·금·일 / 발주 시작(정오)이 있는 날 = 월~토
const KST = 9 * 60 * 60 * 1000;
const DEADLINE_DAYS = new Set([1, 2, 3, 4, 5, 0]); // 월~금, 일
const OPEN_DAYS = new Set([1, 2, 3, 4, 5, 6]); // 월~토

function kstParts(atMs: number) {
  const d = new Date(atMs + KST);
  return { dow: d.getUTCDay(), h: d.getUTCHours() };
}

type Job = { type: string; title: string };

const JOBS: Record<string, Job> = {
  warn: { type: "warn", title: "금일 발주 마감까지 1시간 남았습니다." },
  deadline: { type: "deadline", title: "금일 발주가 마감되었습니다." },
  open: { type: "open", title: "지금부터 발주가 가능합니다." },
};

// 시각 자동판별(수동 테스트용). 스케줄러는 ?type= 으로 명시 호출(지연돼도 정확).
function pick(dow: number, h: number): Job | null {
  if (h === 19 && DEADLINE_DAYS.has(dow)) return JOBS.warn;
  if (h === 20 && DEADLINE_DAYS.has(dow)) return JOBS.deadline;
  if (h === 12 && OPEN_DAYS.has(dow)) return JOBS.open;
  return null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  // ?type= (스케줄러가 명시) 우선, 없으면 ?at= 또는 현재시각으로 자동판별
  const typeParam = url.searchParams.get("type");
  const atParam = url.searchParams.get("at");
  const atMs = atParam ? new Date(atParam).getTime() : Date.now();
  const { dow, h } = kstParts(atMs);

  const job = typeParam ? JOBS[typeParam] : pick(dow, h);
  if (!job) return Response.json({ ok: true, sent: false, dow, h });

  // 멱등: 같은 종류를 같은 KST 날짜에 두 번 보내지 않음(디스패처+GH Actions 겹쳐도 안전)
  const key = `notify:${job.type}:${kstDateOf(new Date(atMs))}`;
  const already = await prisma.appMeta.findUnique({ where: { key } });
  if (already) {
    return Response.json({ ok: true, sent: false, dedup: true, type: job.type });
  }

  await sendPushToRole("MERCHANT_HOTDEAL", {
    title: job.title,
    body: "",
    url: "/order",
  });
  await prisma.appMeta.upsert({
    where: { key },
    create: { key, syncedAt: new Date() },
    update: { syncedAt: new Date() },
  });
  return Response.json({ ok: true, sent: true, type: job.type, dow, h });
}
