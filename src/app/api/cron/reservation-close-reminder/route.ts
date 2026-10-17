import { prisma } from "@/lib/prisma";
import { logError } from "@/lib/log";
import { notifyMerchantsReservationClosingSoon, reservationAudienceIds } from "@/lib/push";

// 공산품(옛 예약발주) 상품 '마감 1시간 전' 리마인더. tick 디스패처가 매 분 호출 → 마지막 1시간 창에
// 진입한 상품을 그 즉시 1회만 발송. 멱등키에 closeAt(ms)을 포함해, 관리자가 마감을 미루면
// 새 리마인더가 다시 나가도록 한다(상품별 무한 발송 방지는 create 원자적 선점).
// 보내기는 이번 실행에서 새로 선점한 상품을 '같은 마감 시각(분)'끼리 묶어 지점마다 1통(2026-10-17~).
// (월 10시 마감 20개를 올려도 알림 1통. 키는 상품별 그대로라 늦게 올라온 상품만 따로 1통 더 간다)
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
    orderBy: [{ closeAt: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, name: true, closeAt: true },
  });

  // 같은 마감 시각(분 단위)끼리 묶기 — 이번 실행에서 새로 선점한 상품만 담는다.
  const groups = new Map<number, { closeAt: Date; names: string[]; ids: string[] }>();
  for (const p of products) {
    const closeAt = p.closeAt as Date;
    const closeMs = closeAt.getTime();
    const key = `resv-warn:${p.id}:${closeMs}`;
    try {
      // 원자적 선점 — 이미 있으면 throw → 스킵(중복 방지, 동시 tick 안전).
      await prisma.appMeta.create({ data: { key, syncedAt: new Date() } });
    } catch {
      continue;
    }
    const minute = Math.floor(closeMs / 60000);
    let g = groups.get(minute);
    if (!g) {
      g = { closeAt, names: [], ids: [] };
      groups.set(minute, g);
    }
    g.names.push(p.name);
    g.ids.push(p.id);
  }

  // 받는 사람 = 공산품이 보이는 지점(지점 '공산품 노출' 켜짐). 보낼 묶음이 있을 때 한 번만 계산.
  const audience = groups.size > 0 ? await reservationAudienceIds() : [];

  let sent = 0;
  for (const g of groups.values()) {
    try {
      await notifyMerchantsReservationClosingSoon(g.closeAt, g.names, audience);
      sent += g.ids.length;
    } catch (err) {
      logError("cron.reservationCloseReminder", err, { productIds: g.ids });
    }
  }

  return Response.json({ ok: true, candidates: products.length, sent, messages: groups.size });
}
