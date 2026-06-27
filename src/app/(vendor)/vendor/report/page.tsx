import { Suspense } from "react";
import Link from "next/link";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { VENDOR_LABEL, type Role } from "@/lib/constants";
import { normalizeDateStr, kstDayRange, labelDate, kstToday } from "@/lib/date";
import { auctionReport } from "@/lib/ai";

export default async function VendorReport(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const isToday = date === kstToday();

  return (
    <>
      <header className="topbar">
        <Link
          href={`/vendor/summary?date=${date}`}
          className="topbar__back"
          aria-label="뒤로"
        >
          ‹
        </Link>
        <div className="topbar__title">경매 입찰 레포트</div>
      </header>
      <div className="page">
        <h1 className="h1">오늘 경매 입찰 전략</h1>
        <p className="lead">
          {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {VENDOR_LABEL[user.role as Role] ?? ""}
        </p>

        <Suspense fallback={<ReportLoading />}>
          <ReportSection
            date={date}
            vendorRole={user.role}
            vendorLabel={VENDOR_LABEL[user.role as Role] ?? "발주"}
            dateLabel={labelDate(date)}
          />
        </Suspense>
      </div>
    </>
  );
}

function ReportLoading() {
  return (
    <div className="empty">
      <div className="statusring statusring--spin" aria-hidden />
      <p style={{ marginTop: 18 }}>
        오늘 발주를 분석해 경매 전략을 짜는 중이에요…
        <br />
        잠시만 기다려 주세요.
      </p>
    </div>
  );
}

async function ReportSection({
  date,
  vendorRole,
  vendorLabel,
  dateLabel,
}: {
  date: string;
  vendorRole: string;
  vendorLabel: string;
  dateLabel: string;
}) {
  const { start, end } = kstDayRange(date);
  const orders = await prisma.order.findMany({
    where: { vendorRole, createdAt: { gte: start, lt: end } },
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

  const report = await auctionReport({
    contextLabel: vendorLabel,
    dateLabel,
    lines,
  });

  if (report.fruits.length === 0) {
    return (
      <div className="empty">
        <p>이 날짜에 분석할 발주가 없어요.</p>
      </div>
    );
  }

  return (
    <>
      {report.overall ? (
        <div className="card" style={{ marginBottom: 14, background: "var(--black)" }}>
          <div
            className="eyebrow"
            style={{ color: "rgba(255,255,255,0.6)", marginBottom: 6 }}
          >
            오늘 경매 전략
          </div>
          <div style={{ color: "#fff", fontSize: 16, lineHeight: 1.6, fontWeight: 600 }}>
            {report.overall}
          </div>
        </div>
      ) : null}

      <div className="stack">
        {report.fruits.map((f, i) => (
          <div className="card" key={i}>
            <div className="spread" style={{ marginBottom: 8 }}>
              <div className="receipt__store" style={{ fontSize: 20 }}>
                {f.fruit}
              </div>
              {f.totalDemand ? (
                <span className="badge badge--ai">필요 {f.totalDemand}</span>
              ) : null}
            </div>

            {f.varieties.length > 0 ? (
              <div style={{ margin: "2px 0 10px" }}>
                {f.varieties.map((v, j) => (
                  <div className="aggline" key={j}>
                    <span className="aggline__store">
                      {v.variety}
                      {v.note ? ` · ${v.note}` : ""}
                    </span>
                    <span className="aggline__qty">{v.qty}</span>
                  </div>
                ))}
              </div>
            ) : null}

            {f.strategy ? (
              <div className="notice notice--info">
                <b>입찰 전략</b>
                <br />
                {f.strategy}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <p className="hint center" style={{ marginTop: 14 }}>
        ※ 발주량 기준 AI 추천이에요. 현장 시세·물량 보고 최종 판단은 직접 하세요.
      </p>
    </>
  );
}
