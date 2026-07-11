import { prisma } from "@/lib/prisma";
import { notifyMerchantWeeklyInvoiceOverdue } from "@/lib/push";
import { logError } from "@/lib/log";

export const maxDuration = 60;

// 주간발주 미입금 안내 — 발행됐지만 아직 미입금(ISSUED)인 WEEKLY 요청서에 계산서당 1회 안내.
// overdueRemindedAt 멱등 마커. 디스패처가 금요일 10시(토요일 마감 전날)에 호출.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const invoices = await prisma.invoice.findMany({
    where: { kind: "WEEKLY", status: "ISSUED", overdueRemindedAt: null },
    select: { id: true, userId: true, total: true },
    take: 500,
  });

  let sent = 0;
  for (const inv of invoices) {
    try {
      await notifyMerchantWeeklyInvoiceOverdue(inv.userId, inv.total);
      await prisma.invoice.updateMany({
        where: { id: inv.id, overdueRemindedAt: null },
        data: { overdueRemindedAt: new Date() },
      });
      sent += 1;
    } catch (e) {
      logError("cron.weekly-overdue", e, { id: inv.id });
    }
  }
  return Response.json({ ok: true, sent, scanned: invoices.length });
}
