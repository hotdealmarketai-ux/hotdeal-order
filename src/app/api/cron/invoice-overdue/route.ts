import { prisma } from "@/lib/prisma";
import { notifyMerchantInvoiceOverdue } from "@/lib/push";
import { logError } from "@/lib/log";

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERDUE_DAYS = 1; // 발행 다음날(발행일 결제 원칙) 미입금이면 안내
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
      kind: "DAILY", // 주간(WEEKLY) 요청서는 이 일일 연체 안내 대상 아님(주간은 토요일 마감 기준)
      splitRequested: false, // 분할 요청/승인 건은 제외(자동매칭 게이트와 동일)
      overdueRemindedAt: null, // 아직 안내 안 보낸 것만(멱등)
      issuedAt: { gte: floor, lte: cutoff },
    },
    select: { id: true, userId: true, date: true, total: true },
    orderBy: { issuedAt: "asc" }, // 오래된 미납부터(정산 안 된 점포가 take:500에 밀리지 않게)
    take: 500,
  });

  if (dryrun) {
    return Response.json({ ok: true, dryrun: true, days, candidates: invoices.length });
  }

  // 계산서 개별 '입금확인'을 없애(2026-08-05~) 결제돼도 ISSUED로 남으므로, '낱장'이 아니라 '지점 총미수'로 안내한다:
  //  · 점포별로 미수 잔액(발행 ISSUED + 조정)을 구해, 0 이하면 다 갚은 것 → 안내 생략(마커도 안 남김).
  //  · 남아 있으면 그 점포에 '미수 {잔액}원' 1회만 안내(계산서마다 각각 독촉/금액 부풀림 방지)하고,
  //    이 점포의 후보 계산서 전부에 overdueRemindedAt 마커를 찍어 재독촉을 막는다.
  const userIds = [...new Set(invoices.map((i) => i.userId))];
  const [billed, adj] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { userId: { in: userIds }, status: "ISSUED" },
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
      continue; // 다 갚은 점포 — 안내 생략(마커 안 남김 → 이후 미수 생기면 정상 안내)
    }
    const ids = invs.map((i) => i.id);
    // 원자 선점 — 발송 '전에' overdueRemindedAt(=null)만 먼저 마킹. 겹친 실행이 이미 마킹했으면
    //   count===0 → 스킵(이중 안내 방지). read→발송→mark 는 겹치면 둘 다 발송됐다.
    const claim = await prisma.invoice.updateMany({
      where: { id: { in: ids }, overdueRemindedAt: null },
      data: { overdueRemindedAt: new Date() },
    });
    if (claim.count === 0) {
      skipped += invs.length;
      continue;
    }
    // 대표 날짜 = 가장 오래된 미납 계산서. 금액은 지점 총미수.
    const oldest = invs.reduce((a, b) => (a.date <= b.date ? a : b));
    try {
      await notifyMerchantInvoiceOverdue(uid, oldest.date, bal.get(uid) ?? 0);
      sent += 1;
    } catch (err) {
      // 발송 실패 → 마커 되돌려 다음 실행에서 재시도(무음 유실 방지).
      await prisma.invoice
        .updateMany({ where: { id: { in: ids } }, data: { overdueRemindedAt: null } })
        .catch(() => {});
      logError("cron.invoiceOverdue.notify", err, { userId: uid });
    }
  }
  return Response.json({ ok: true, days, candidates: invoices.length, stores: byUser.size, sent, skipped });
}
