import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { notifyMerchantsReservationClosingSoon } from "@/lib/push";

// 예약발주 상품 '마감 1시간 전' 리마인더. tick 디스패처가 매 분 호출 → 마지막 1시간 창에
// 진입한 상품을 그 즉시 1회만 발송. 멱등키에 closeAt(ms)을 포함해, 관리자가 마감을 미루면
// 새 리마인더가 다시 나가도록 한다(상품별 무한 발송 방지는 create 원자적 선점).
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }

  const now = Date.now();
  const soon = new Date(now + 60 * 60 * 1000); // +1시간

  // flat 상품(closeAt≠null) 중 지금부터 1시간 이내 마감분.
  const products = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      closeAt: { gt: new Date(now), lte: soon },
      batch: { active: true },
    },
    select: { id: true, name: true, closeAt: true },
  });

  const sent: string[] = [];
  for (const p of products) {
    const closeMs = (p.closeAt as Date).getTime();
    const key = `resv-warn:${p.id}:${closeMs}`;
    try {
      // 원자적 선점 — 이미 있으면 throw → 스킵(중복 방지, 동시 tick 안전).
      await prisma.appMeta.create({ data: { key, syncedAt: new Date() } });
    } catch {
      continue;
    }
    try {
      await notifyMerchantsReservationClosingSoon(p.name);
      sent.push(p.id);
    } catch (err) {
      logError("cron.reservationCloseReminder", err, { productId: p.id });
    }
  }

  return Response.json({ ok: true, candidates: products.length, sent: sent.length });
}
