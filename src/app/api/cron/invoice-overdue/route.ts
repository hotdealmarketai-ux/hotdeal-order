import { prisma } from "@/lib/prisma";
import { notifyMerchantInvoiceOverdue } from "@/lib/push";
import { logError } from "@/lib/log";

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_DAYS = 2; // 발행 후 N일 미입금이면 안내
const MAX_AGE_DAYS = 30; // 그보다 오래된 미입금은 안내 대상에서 제외(대량 발송 방지)

// 입금 기한 안내 크론 — 매일 1회. 발행 후 N일 이상 지난 미입금(ISSUED, 비분할) 계산서에
// '아직 미입금' 안내 푸시. overdueRemindedAt 멱등 마커로 계산서당 1회만(중복·반복 방지),
// 크론이 하루 놓쳐도 다음 실행에서 캐치업. 분할 요청/승인 건은 제외(정산 협의 중).
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

  const cutoff = new Date(now - days * DAY_MS); // 발행 후 N일 경과 기준
  const floor = new Date(now - MAX_AGE_DAYS * DAY_MS); // 그보다 오래된 건 제외

  const invoices = await prisma.invoice.findMany({
    where: {
      status: "ISSUED",
      splitRequested: false, // 분할 요청/승인 건은 제외(자동매칭 게이트와 동일)
      overdueRemindedAt: null, // 아직 안내 안 보낸 것만(멱등)
      issuedAt: { gte: floor, lte: cutoff },
    },
    select: { id: true, userId: true, date: true, total: true },
    take: 500,
  });

  if (dryrun) {
    return Response.json({ ok: true, dryrun: true, days, candidates: invoices.length });
  }

  let sent = 0;
  for (const inv of invoices) {
    try {
      await notifyMerchantInvoiceOverdue(inv.userId, inv.date, inv.total);
      await prisma.invoice.update({
        where: { id: inv.id },
        data: { overdueRemindedAt: new Date() },
      });
      sent++;
    } catch (err) {
      logError("cron.invoiceOverdue.notify", err, { invoiceId: inv.id });
    }
  }
  return Response.json({ ok: true, days, candidates: invoices.length, sent });
}
