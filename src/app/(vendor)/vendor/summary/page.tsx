import { Suspense } from "react";
import { Topbar } from "@/components/Topbar";
import Link from "next/link";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { VENDOR_LABEL, type Role } from "@/lib/constants";
import {
  normalizeDateStr,
  labelDate,
  kstToday,
  orderRangeForShipment,
} from "@/lib/date";
import { aggregateOrders } from "@/lib/ai";
import { getReservationLinesForPickup } from "@/lib/reservation-data";
import { displayQty } from "@/lib/qty";

export default async function VendorSummary(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const isToday = date === kstToday();

  return (
    <>
      <Topbar backHref={`/vendor?date=${date}`} title="전체 집계 발주" />
      <div className="page">
        <h1 className="h1">{isToday ? "오늘 전체주문" : "전체주문 집계"}</h1>
        <p className="lead">
          출고 {labelDate(date)} · {VENDOR_LABEL[user.role as Role] ?? ""}
        </p>

        {user.role === "VENDOR_SEOBU" && (
          <Link
            href={`/vendor/report?date=${date}`}
            className="btn btn--primary"
            style={{ marginBottom: 16 }}
          >
            발주 레포트 생성
          </Link>
        )}

        <Suspense fallback={<AggLoading />}>
          <AggregateSection
            date={date}
            vendorRole={user.role}
            vendorLabel={VENDOR_LABEL[user.role as Role] ?? "발주"}
          />
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
        전 지점 발주를 품목·종류로 묶는 중이에요…
        <br />
        잠시만 기다려 주세요.
      </p>
    </div>
  );
}

async function AggregateSection({
  date,
  vendorRole,
  vendorLabel,
}: {
  date: string;
  vendorRole: string;
  vendorLabel: string;
}) {
  // date = 출고일 → 그 출고일에 실린 발주(전날/주말) 범위로 집계.
  const { start, end } = orderRangeForShipment(date);
  const orders = await prisma.order.findMany({
    where: { vendorRole, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    include: { user: true, items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });

  const lines = orders.flatMap((o) =>
    o.items.map((it) => ({
      store: o.user.storeName,
      name: it.name || it.rawName,
      // 폴백 원문에도 displayQty 적용 — '4다이'(등급) 같은 값이 수량으로 되살아나 합산되는 사고 방지.
      qty: it.qty || displayQty(it.rawQty),
      note: it.note || it.rawNote,
    })),
  );

  // 공구 벤더(새롭)만: 확정 예약분(픽업=출고일)도 집계에 합류 — 창고가 총 준비량을 한 번에.
  // 예약분은 실제 발주(Order)에 없어 별도 조회. 라인에 '예약' 표시로 구분.
  let reservedCount = 0;
  if (vendorRole === "ADMIN_SAEROP") {
    const resv = await getReservationLinesForPickup(date);
    reservedCount = resv.length;
    for (const r of resv) {
      lines.push({ store: r.store, name: r.name, qty: String(r.qty), note: "예약" });
    }
  }

  // 과일·야채는 상세 분류(produce), 공구·두부류는 같으면 묶기(simple)
  const mode =
    vendorRole === "VENDOR_SEOBU" || vendorRole === "VENDOR_JANGHEUNG"
      ? "produce"
      : "simple";
  const agg = await aggregateOrders({ categoryLabel: vendorLabel, lines }, mode);

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
        지점 발주 {orders.length}건
        {reservedCount > 0 ? ` + 예약분 ${reservedCount}건` : ""}을 품목{" "}
        {agg.fruits.length}종으로 묶었어요.
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
