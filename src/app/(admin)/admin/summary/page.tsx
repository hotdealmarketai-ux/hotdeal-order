import { Suspense } from "react";
import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { normalizeDateStr, kstDayRange, labelDate, kstToday } from "@/lib/date";
import { aggregateOrders, type AggregateMode } from "@/lib/ai";

type ScopeDef = { label: string; where: Prisma.OrderWhereInput; mode: AggregateMode };
const HOTDEAL = { user: { role: "MERCHANT_HOTDEAL" } } as const;

function resolve(ctx: string, scope: string) {
  const hotdeal: Record<string, ScopeDef> = {
    all: { label: "전체발주", where: { ...HOTDEAL }, mode: "produce" },
    fruit: { label: "과일발주", where: { ...HOTDEAL, category: "FRUIT" }, mode: "produce" },
    veg: { label: "야채발주", where: { ...HOTDEAL, category: "VEG" }, mode: "produce" },
    tofu: { label: "채움채", where: { ...HOTDEAL, category: "TOFU" }, mode: "simple" },
    tool: { label: "공구발주", where: { ...HOTDEAL, category: "TOOL" }, mode: "simple" },
  };
  const orders: Record<string, ScopeDef> = {
    all: { label: "전체", where: {}, mode: "produce" },
    hotdeal: { label: "핫딜마켓", where: { ...HOTDEAL }, mode: "produce" },
    seobu: { label: "서부일광", where: { vendorRole: "VENDOR_SEOBU" }, mode: "produce" },
    jangheung: { label: "장흥", where: { vendorRole: "VENDOR_JANGHEUNG" }, mode: "produce" },
    chaeumchae: { label: "채움채", where: { vendorRole: "VENDOR_CHAEUMCHAE" }, mode: "simple" },
    saerop: { label: "주식회사 새롭", where: { vendorRole: "ADMIN_SAEROP" }, mode: "simple" },
  };
  const map = ctx === "hotdeal" ? hotdeal : orders;
  const sel = map[scope] ?? map.all;
  const base = ctx === "hotdeal" ? "/admin/hotdeal" : "/admin/orders";
  return { ...sel, backHref: `${base}?scope=${scope}` };
}

export default async function AdminSummary(props: {
  searchParams: Promise<{ ctx?: string; scope?: string; date?: string }>;
}) {
  await requireAdmin();
  const { ctx = "orders", scope = "all", date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const sel = resolve(ctx, scope);

  return (
    <>
      <header className="topbar">
        <Link href={`${sel.backHref}&date=${date}`} className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">{sel.label} 집계</div>
      </header>
      <div className="page">
        <h1 className="h1">{sel.label} 집계</h1>
        <p className="lead">
          {labelDate(date)}
          {date === kstToday() ? " (오늘)" : ""}
        </p>
        <Suspense fallback={<AggLoading />}>
          <AggSection date={date} where={sel.where} label={sel.label} mode={sel.mode} />
        </Suspense>
      </div>
    </>
  );
}

function AggLoading() {
  return (
    <div className="empty">
      <div className="statusring statusring--spin" aria-hidden />
      <p style={{ marginTop: 18 }}>
        발주를 품목·종류로 묶는 중이에요…
        <br />
        잠시만 기다려 주세요.
      </p>
    </div>
  );
}

async function AggSection({
  date,
  where,
  label,
  mode,
}: {
  date: string;
  where: Prisma.OrderWhereInput;
  label: string;
  mode: AggregateMode;
}) {
  const { start, end } = kstDayRange(date);
  const orders = await prisma.order.findMany({
    where: { ...where, createdAt: { gte: start, lt: end } },
    include: { user: true, items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  const lines = orders.flatMap((o) =>
    o.items.map((it) => ({
      store: o.user.storeName,
      name: it.name || it.rawName,
      qty: it.qty || it.rawQty,
      note: it.note || it.rawNote,
    })),
  );
  const agg = await aggregateOrders({ categoryLabel: label, lines }, mode);

  if (agg.fruits.length === 0) {
    return (
      <div className="empty">
        <p>해당 날짜에 집계할 발주가 없습니다.</p>
      </div>
    );
  }

  return (
    <>
      <div className="notice notice--ai" style={{ marginBottom: 14 }}>
        지점 발주 {orders.length}건을 품목 {agg.fruits.length}종으로 묶었어요.
      </div>
      <div className="stack">
        {agg.fruits.map((f, i) => (
          <div className="card" key={i}>
            <div className="spread" style={{ marginBottom: 8 }}>
              <div className="receipt__store" style={{ fontSize: 20 }}>
                {f.fruit || "(품목 미지정)"}
              </div>
              {f.total ? <span className="badge badge--ai">합계 {f.total}</span> : null}
            </div>
            {f.varieties.map((v, j) => (
              <div key={j} style={{ marginTop: j > 0 ? 14 : 0 }}>
                {v.variety ? (
                  <div className="spread" style={{ marginBottom: 4 }}>
                    <span className="chip">{v.variety}</span>
                    <span className="badge badge--mute">
                      {v.total || `${v.lines.length}개 지점`}
                    </span>
                  </div>
                ) : null}
                <div className="divider" style={{ margin: "2px 0 8px" }} />
                {v.lines.map((l, k) => (
                  <div className="aggline" key={k}>
                    <span className="aggline__store">
                      {l.store}
                      {l.note ? ` · ${l.note}` : ""}
                    </span>
                    <span className="aggline__qty">{l.qty}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
