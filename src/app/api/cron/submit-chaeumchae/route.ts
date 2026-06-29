import { prisma } from "@/lib/prisma";
import { CHAEUMCHAE_CATALOG, seqForName } from "@/lib/chaeumchae";
import { submitChaeumchae, type SubmitItem } from "@/lib/chaeumchae-submit";
import { sendPushToRole } from "@/lib/push";
import { currentWindowStartUtc } from "@/lib/schedule";
import { kstDateOf } from "@/lib/date";

const DAY_MS = 24 * 60 * 60 * 1000;

async function alertAdmin() {
  await sendPushToRole("ADMIN_SAEROP", {
    title: "채움채 발주에 실패하였습니다.",
    body: "",
    url: "/admin",
  }).catch(() => {});
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  const qsecret = url.searchParams.get("secret");
  if (!secret || (auth !== `Bearer ${secret}` && qsecret !== secret)) {
    return new Response("forbidden", { status: 403 });
  }

  const dryrun = url.searchParams.get("dryrun") === "1";
  // 출고일 = 다음날(20:30 제출 기준). ?at= 으로 테스트 시각 시뮬레이션.
  const atParam = url.searchParams.get("at");
  const now = atParam ? new Date(atParam).getTime() : Date.now();
  const orderDay = kstDateOf(new Date(now + DAY_MS));

  // 이번 발주 창(평일=당일 12시~, 주말=토 12시~)의 핫딜 가맹점 두부류 발주 취합
  const since = new Date(currentWindowStartUtc(now));
  const orders = await prisma.order.findMany({
    where: {
      category: "TOFU",
      createdAt: { gte: since },
      user: { role: "MERCHANT_HOTDEAL" },
    },
    include: { items: true },
  });

  const bySeq = new Map<string, { name: string; qty: number }>();
  let unmapped = 0;
  for (const o of orders) {
    for (const it of o.items) {
      const seq = seqForName(it.name);
      if (!seq) {
        unmapped++;
        continue;
      }
      const q = parseInt(String(it.qty).replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(q) || q <= 0) continue;
      const name = CHAEUMCHAE_CATALOG.find((p) => p.seq === seq)?.name ?? it.name;
      const cur = bySeq.get(seq);
      bySeq.set(seq, { name, qty: (cur?.qty ?? 0) + q });
    }
  }
  const items: SubmitItem[] = [...bySeq.entries()].map(([seq, v]) => ({
    seq,
    name: v.name,
    quantity: v.qty,
  }));

  if (items.length === 0) {
    return Response.json({ ok: true, submitted: false, reason: "두부 발주 없음", orderDay, unmapped });
  }
  if (dryrun) {
    return Response.json({ ok: true, dryrun: true, orderDay, items, unmapped });
  }

  try {
    const results = await submitChaeumchae(orderDay, items);
    const failed = results.filter((r) => r.result === "ERR");
    if (failed.length > 0) await alertAdmin();
    return Response.json({
      ok: failed.length === 0,
      submitted: true,
      orderDay,
      results,
      unmapped,
    });
  } catch (err) {
    console.error("[chaeumchae] submit failed:", err);
    await alertAdmin();
    return Response.json(
      { ok: false, error: String(err), orderDay },
      { status: 500 },
    );
  }
}
