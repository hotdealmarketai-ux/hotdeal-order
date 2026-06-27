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
        <h1 className="h1">오늘 경매 입찰 레포트</h1>
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
        오늘 발주를 분석해 레포트를 작성하는 중이에요…
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

  const report = await auctionReport({ contextLabel: vendorLabel, dateLabel, lines });

  if (report.bids.length === 0) {
    return (
      <div className="empty">
        <p>이 날짜에 분석할 발주가 없어요.</p>
      </div>
    );
  }

  return (
    <>
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="section-label" style={{ margin: "0 0 10px" }}>
          오늘 입찰 수량
        </div>
        {report.bids.map((b, i) => (
          <div className="aggline" key={i}>
            <span className="aggline__store">
              {b.fruit}
              {b.tag ? ` · ${b.tag}` : ""}
            </span>
            <span className="aggline__qty">{b.qty}</span>
          </div>
        ))}
      </div>

      {report.paragraphs.length > 0 ? (
        <div className="card">
          <div className="section-label" style={{ margin: "0 0 12px" }}>
            경매 진행 레포트
          </div>
          {report.paragraphs.map((p, i) => (
            <p
              key={i}
              style={{
                margin: i > 0 ? "12px 0 0" : "0",
                fontSize: 15,
                lineHeight: 1.75,
                color: "var(--fg-2)",
              }}
            >
              {p}
            </p>
          ))}
        </div>
      ) : null}

      <p className="hint center" style={{ marginTop: 14 }}>
        ※ 발주량 기준 AI 정리입니다. 현장 시세·물량 보고 최종 판단하세요.
      </p>
    </>
  );
}
