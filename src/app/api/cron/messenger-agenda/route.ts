import { prisma } from "@/lib/prisma";
import { notifyMessengerTodayAgenda } from "@/lib/messenger-push";

// 사내 메신저 — 오늘(KST) 잡혀 있는 캘린더 일정을 아침에 전 멤버에게 웹푸시.
// tick 디스패처가 매일 08:00 KST에 1회 호출(멱등: 일정 없으면 아무것도 안 보냄).
const KST = 9 * 60 * 60 * 1000;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  const now = Date.now();
  const d = new Date(now + KST);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0) - KST);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  const events = await prisma.messengerEvent.findMany({
    where: { date: { gte: start, lt: end } },
    orderBy: { date: "asc" },
    select: { title: true },
  });
  await notifyMessengerTodayAgenda(events.map((e) => e.title));
  return Response.json({ ok: true, count: events.length });
}
