import { prisma } from "@/lib/prisma";
import { notifyMerchantInvoiceOverdue } from "@/lib/push";
import { kstDateOf, kstDayRange } from "@/lib/date";
import { logError } from "@/lib/log";

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_DAYS = 2; // 계산서 발행 후 N일 미입금이면 그날 1회 안내

// 입금 기한 안내 크론 — 매일 1회. N일 전 발행된 미입금(ISSUED) 계산서에 안내 푸시.
// 그날 하루치만 대상 → 같은 계산서에 매일 반복 알림하지 않음(스팸 방지).
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const dParam = parseInt(url.searchParams.get("days") ?? "", 10);
  const days = Number.isFinite(dParam) && dParam > 0 ? dParam : OVERDUE_DAYS;
  const atParam = url.searchParams.get("at"); // 테스트용 기준시각
  const now = atParam ? new Date(atParam).getTime() : Date.now();
  const dryrun = url.searchParams.get("dryrun") === "1";

  // N일 전 KST 날짜에 '발행'된 미입금 계산서만(그날 하루치)
  const targetDate = kstDateOf(new Date(now - days * DAY_MS));
  const { start, end } = kstDayRange(targetDate);

  const invoices = await prisma.invoice.findMany({
    where: { status: "ISSUED", issuedAt: { gte: start, lt: end } },
    select: { id: true, userId: true, date: true, total: true },
  });

  if (dryrun) {
    return Response.json({ ok: true, dryrun: true, targetDate, days, candidates: invoices.length });
  }

  let sent = 0;
  for (const inv of invoices) {
    try {
      await notifyMerchantInvoiceOverdue(inv.userId, inv.date, inv.total);
      sent++;
    } catch (err) {
      logError("cron.invoiceOverdue.notify", err, { invoiceId: inv.id });
    }
  }
  return Response.json({ ok: true, targetDate, days, candidates: invoices.length, sent });
}
