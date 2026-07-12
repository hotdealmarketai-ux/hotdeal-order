import { prisma } from "@/lib/prisma";
import { CHAEUMCHAE_CATALOG, seqForName } from "@/lib/chaeumchae";
import { submitChaeumchae, type SubmitItem } from "@/lib/chaeumchae-submit";
import { sendPushToRole } from "@/lib/push";
import { currentWindowStartUtc } from "@/lib/schedule";
import { kstDateOf } from "@/lib/date";
import { logError } from "@/lib/log";

const DAY_MS = 24 * 60 * 60 * 1000;

// 수량 문자열을 안전하게 정수로. replace(/[^0-9]/g,'')로 소수점을 '지우면' "1.5"→"15"(10배)로
// 자릿수가 붙어 외부 채움채에 과다발주되는 사고가 난다. 소수점을 살려 파싱한 뒤 반올림(두부는 정수 단위).
function parseTofuQty(raw: unknown): number {
  const m = String(raw ?? "").match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

async function alertAdmin() {
  await sendPushToRole("ADMIN_SAEROP", {
    title: "채움채 발주에 실패하였습니다.",
    body: "",
    url: "/admin",
  }).catch((e) => logError("cron.chaeumchae.alertAdmin", e));
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const url = new URL(request.url);
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
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
      status: { not: "CANCELLED" },
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
      const q = parseTofuQty(it.qty);
      if (q <= 0) continue;
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

  // 멱등: 같은 출고일엔 한 번만 제출(디스패처+GH Actions 동시 실행에도 중복 제출 방지).
  // 원자적 claim(create) — 동시 두 호출 중 하나만 성공(@id 유니크). ?force=1 은 수동 재실행(claim 무시).
  const force = url.searchParams.get("force") === "1";
  const claimKey = `chaeumchae:${orderDay}`;
  if (!force) {
    try {
      await prisma.appMeta.create({ data: { key: claimKey } });
    } catch {
      // 이미 claim됨(동시 실행 또는 이전에 제출 완료) → 스킵
      return Response.json({ ok: true, submitted: false, dedup: true, orderDay });
    }
  }

  try {
    const results = await submitChaeumchae(orderDay, items);
    const failed = results.filter((r) => r.result === "ERR");
    if (failed.length > 0) {
      logError("cron.chaeumchae.itemsFailed", new Error("일부 채움채 자동제출 실패"), {
        orderDay,
        failedCount: failed.length,
        total: results.length,
      });
      await alertAdmin();
    }
    return Response.json({
      ok: failed.length === 0,
      submitted: true,
      orderDay,
      results,
      unmapped,
    });
  } catch (err) {
    // 제출이 던진 실패(아무것도 안 나감) → claim 롤백해 다음 실행에서 재시도 가능하게(무음 유실 방지).
    if (!force) {
      await prisma.appMeta.deleteMany({ where: { key: claimKey } }).catch(() => {});
    }
    logError("cron.chaeumchae.submit", err, { orderDay, items: items.length });
    await alertAdmin();
    return Response.json(
      { ok: false, error: String(err), orderDay },
      { status: 500 },
    );
  }
}
