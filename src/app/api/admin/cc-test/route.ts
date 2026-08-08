// ⚠⚠ 임시 테스트 라우트 — 채움채(hancuc) 홈페이지 발주 수동 테스트용. 검증 후 즉시 삭제할 것.
// 관리자 세션 게이트. 크론(submit-chaeumchae)의 취합 로직을 그대로 재현해 '어제 발주창'의 두부류를 뽑는다.
//   ?do=preview (기본) — 취합만(외부 호출 없음). 무엇이 나갈지 확인용.
//   ?do=submit         — 실제 채움채 홈페이지로 제출(외부 쓰기).
//   ?do=state          — 현재 채움채에 잡힌 주문 상태 조회(외부 읽기).
//   ?at=<ISO>          — 취합 기준 시각(기본: 어제 20:00 KST → 어제 정오창 전체 포착).
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isAdmin, type Role } from "@/lib/constants";
import { CHAEUMCHAE_CATALOG, seqForName } from "@/lib/chaeumchae";
import {
  submitChaeumchae,
  fetchChaeumchaeState,
  type SubmitItem,
} from "@/lib/chaeumchae-submit";
import { currentWindowStartUtc } from "@/lib/schedule";
import { kstDateOf } from "@/lib/date";

const DAY_MS = 24 * 60 * 60 * 1000;

// 소수점 살려 파싱 후 반올림(크론과 동일 — "1.5"→"15" 10배 과다발주 방지).
function parseTofuQty(raw: unknown): number {
  const m = String(raw ?? "").match(/\d+(?:\.\d+)?/);
  if (!m) return 0;
  const n = parseFloat(m[0]);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role as Role)) {
    return new Response("forbidden", { status: 403 });
  }

  const url = new URL(request.url);
  const doParam = (url.searchParams.get("do") || "preview").toLowerCase();

  if (doParam === "state") {
    try {
      return Response.json({ ok: true, state: await fetchChaeumchaeState() });
    } catch (err) {
      return Response.json({ ok: false, error: String(err) }, { status: 502 });
    }
  }

  // 기준 시각: 어제 20:00 KST(정오창이 이미 열린 뒤라 어제 발주 전체를 포착). ?at= 로 덮어쓰기.
  const atParam = url.searchParams.get("at");
  const at = atParam
    ? new Date(atParam).getTime()
    : Date.parse(`${kstDateOf(new Date(Date.now() - DAY_MS))}T20:00:00+09:00`);
  const since = new Date(currentWindowStartUtc(at));
  const orderDay = kstDateOf(new Date(at + DAY_MS));

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
  const skipped: string[] = [];
  for (const o of orders) {
    for (const it of o.items) {
      const seq = seqForName(it.name);
      if (!seq) {
        skipped.push(it.name.trim() || "(이름없음)");
        continue;
      }
      const q = parseTofuQty(it.qty);
      if (q <= 0) {
        skipped.push(it.name.trim() || "(이름없음)");
        continue;
      }
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
  const meta = {
    sinceKst: kstDateOf(since),
    since: since.toISOString(),
    orderDayComputed: orderDay,
    orderCount: orders.length,
    skipped: [...new Set(skipped)],
  };

  if (doParam === "submit") {
    if (items.length === 0) {
      return Response.json({ ok: true, submitted: false, reason: "두부 발주 없음", ...meta });
    }
    try {
      const { orderDay: usedDay, results } = await submitChaeumchae(orderDay, items);
      return Response.json({ ok: true, submitted: true, hancucOrderDay: usedDay, items, results, ...meta });
    } catch (err) {
      return Response.json({ ok: false, submitted: false, error: String(err), items, ...meta }, { status: 502 });
    }
  }

  // preview (기본)
  return Response.json({ ok: true, submitted: false, preview: true, items, ...meta });
}
