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
    orderBy: { issuedAt: "asc" }, // 오래된 미납부터(정산 안 된 점포가 take:500에 밀리지 않게)
    take: 500,
  });

  // 계산서 개별 '입금확인' 폐지(2026-08-05~)로 결제 후에도 ISSUED로 남으므로, '낱장'이 아니라 '지점 총미수'로 안내:
  //  점포별 미수 잔액(발행 + 조정)이 0 이하면 정산된 것 → 생략. 남아 있으면 그 점포에 '미수 {잔액}' 1회만 안내하고
  //  그 점포의 주간 후보 전부에 마커. (계산서마다 각각 독촉/금액 부풀림 방지)
  const userIds = [...new Set(invoices.map((i) => i.userId))];
  const [billed, adj] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, status: "ISSUED", kind: { not: "SADADREAM" } },
      _sum: { total: true },
    }),
    prisma.receivableAdjustment.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds } },
      _sum: { amount: true },
    }),
  ]);
  const bal = new Map<string, number>();
  for (const b of billed) bal.set(b.userId, b._sum.total ?? 0);
  for (const a of adj) bal.set(a.userId, (bal.get(a.userId) ?? 0) + (a._sum.amount ?? 0));

  const byUser = new Map<string, typeof invoices>();
  for (const inv of invoices) {
    const arr = byUser.get(inv.userId);
    if (arr) arr.push(inv);
    else byUser.set(inv.userId, [inv]);
  }

  let sent = 0;
  let skipped = 0;
  for (const [uid, invs] of byUser) {
    if ((bal.get(uid) ?? 0) <= 0) {
      skipped += invs.length;
      continue;
    }
    const ids = invs.map((i) => i.id);
    // 원자 선점 — 발송 전에 overdueRemindedAt(=null)만 먼저 마킹. 겹친 실행이 이미 마킹했으면 스킵(이중 안내 방지).
    const claim = await prisma.invoice.updateMany({
      where: { id: { in: ids }, overdueRemindedAt: null },
      data: { overdueRemindedAt: new Date() },
    });
    if (claim.count === 0) {
      skipped += invs.length;
      continue;
    }
    try {
      await notifyMerchantWeeklyInvoiceOverdue(uid, bal.get(uid) ?? 0);
      sent += 1;
    } catch (e) {
      await prisma.invoice
        .updateMany({ where: { id: { in: ids } }, data: { overdueRemindedAt: null } })
        .catch(() => {});
      logError("cron.weekly-overdue", e, { userId: uid });
    }
  }
  return Response.json({ ok: true, sent, skipped, scanned: invoices.length, stores: byUser.size });
}
