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
  // 원자 선점(키가 @id) — findUnique→발송→upsert 는 겹치면 전 가맹점에 '두 번' 발송된다.
  //   발송 전에 create 로 원자적으로 선점하고, 실패 시 되돌린다(notify 크론과 동일 패턴).
  try {
    await prisma.appMeta.create({ data: { key, syncedAt: new Date() } });
  } catch {
    return Response.json({ ok: true, sent: false, dedup: true, type: job.type });
  }

  try {
    await sendPushToRole("MERCHANT_HOTDEAL", {
      title: job.title,
      body: "",
      url: "/weekly",
    });
    // 마감(20시)엔 새롭 관리자에게도 확인 요청 푸시
    if (job.type === "deadline") {
      await sendPushToRole("ADMIN_SAEROP", {
        title: "주간발주가 마감되었습니다. 지금 확인해주세요!",
        body: "",
        url: "/admin/weekly",
      });
    }
  } catch (err) {
    // 발송 실패 시 선점 되돌려 다음 실행에서 재시도(무음 유실 방지).
    await prisma.appMeta.deleteMany({ where: { key } }).catch(() => {});
    throw err;
  }
  return Response.json({ ok: true, sent: true, type: job.type, dow, h });
}
