import { sendPushToRole } from "@/lib/push";

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

function pick(dow: number, h: number): Job | null {
  if (h === 19 && DEADLINE_DAYS.has(dow))
    return { type: "warn", title: "금일 발주 마감까지 1시간 남았습니다." };
  if (h === 20 && DEADLINE_DAYS.has(dow))
    return { type: "deadline", title: "금일 발주가 마감되었습니다." };
  if (h === 12 && OPEN_DAYS.has(dow))
    return { type: "open", title: "지금부터 발주가 가능합니다." };
  return null;
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  const qsecret = url.searchParams.get("secret");
  if (!secret || (auth !== `Bearer ${secret}` && qsecret !== secret)) {
    return new Response("forbidden", { status: 403 });
  }

  // ?at=ISO 로 시각 시뮬레이션(테스트용)
  const atParam = url.searchParams.get("at");
  const atMs = atParam ? new Date(atParam).getTime() : Date.now();
  const { dow, h } = kstParts(atMs);

  const job = pick(dow, h);
  if (!job) return Response.json({ ok: true, sent: false, dow, h });

  await sendPushToRole("MERCHANT_HOTDEAL", {
    title: job.title,
    body: "",
    url: "/order",
  });
  return Response.json({ ok: true, sent: true, type: job.type, dow, h });
}
