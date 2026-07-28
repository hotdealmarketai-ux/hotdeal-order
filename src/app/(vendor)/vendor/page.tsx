import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, VENDOR_LABEL, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import {
  normalizeDateStr,
  labelDate,
  kstToday,
  orderRangeForShipment,
  shipmentDayOf,
  dowOf,
} from "@/lib/date";
import { LogoutButton } from "@/components/LogoutButton";
import { VendorDateBar } from "@/components/VendorDateBar";
import { getReservationLinesForPickup } from "@/lib/reservation-data";

export default async function VendorPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  const { date: dateParam } = await props.searchParams;
  // date = '출고일'. 이 날 출고할 발주(= 전날 발주, 월요일 출고는 토·일 발주)를 조회한다.
  const date = normalizeDateStr(dateParam);
  const isSunday = dowOf(date) === 0; // 일요일은 출고 없음
  const { start, end } = orderRangeForShipment(date);
  const isToday = date === kstToday();

  const orders = await prisma.order.findMany({
    where: { vendorRole: user.role, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  // 공구 벤더(새롭)만: 확정 예약분(픽업=출고일)도 함께 준비하도록 읽기전용 표시.
  // 예약분은 실제 발주(Order)에 없어 별도 조회. 발주 목록엔 안 뜨니 이 날 누락 방지.
  const reserved =
    user.role === "ADMIN_SAEROP" ? await getReservationLinesForPickup(date) : [];

  return (
    <>
      <Topbar
        title="들어온 발주"
        right={<TopbarChip>{VENDOR_LABEL[user.role] ?? user.storeName}</TopbarChip>}
      />
      <div className="page">
        <h1 className="h1">발주 목록</h1>
        <p className="lead" style={{ marginBottom: 2 }}>
          출고 {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {orders.length}건
        </p>
        <p style={{ margin: "0 0 8px", fontSize: 12, color: "var(--muted)" }}>
          이 날 출고할 발주예요 · 발주일은 전날(월요일 출고 = 토·일 발주)
        </p>

        <VendorDateBar
          date={date}
          labelPrefix="출고 "
          max={shipmentDayOf(kstToday())}
        />

        <Link
          href={`/vendor/summary?date=${date}`}
          className="btn btn--primary"
          style={{ marginBottom: 16 }}
        >
          {isToday ? "오늘 전체주문 집계 보기" : "이 날짜 전체주문 집계"}
        </Link>

        {orders.length === 0 ? (
          <div className="empty">
            <p>
              {isSunday
                ? "일요일은 출고가 없어요. (토·일 발주는 월요일 출고)"
                : "이 날 출고할 발주가 없습니다."}
            </p>
          </div>
        ) : (
          <div className="list">
            {orders.map((o) => {
              const cat = CATEGORIES[o.category as Category];
              return (
                <Link href={`/vendor/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">{o.user.storeName}</div>
                    <div className="row__sub">
                      {formatKDateTime(o.createdAt)} · {cat.label} {o._count.items}건
                      {o.pickupTime ? ` · 픽업 ${o.pickupTime}` : ""}
                    </div>
                  </div>
                  {o.edited && !o.confirmed ? (
                    <span className="badge badge--edit">발주 수정</span>
                  ) : o.confirmed ? (
                    <span className="badge badge--ok">발주 확인</span>
                  ) : (
                    <span className="row__chev">›</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        {reserved.length > 0 && (
          <div className="card" style={{ marginTop: 18 }}>
            <div className="spread" style={{ marginBottom: 6 }}>
              <span className="section-label">예약 출고분</span>
              <span className="badge badge--ai">{reserved.length}건</span>
            </div>
            <p style={{ margin: "0 0 10px", fontSize: 12, color: "var(--muted)" }}>
              확정 예약분(픽업 {labelDate(date)}) — 발주 목록엔 없지만 이 날 함께 준비해요.
            </p>
            {reserved.map((r, i) => (
              <div className="aggline" key={i}>
                <span className="aggline__store">
                  {r.store} · {r.name}
                </span>
                <span className="aggline__qty">{r.qty}</span>
              </div>
            ))}
          </div>
        )}

        {user.role !== "ADMIN_SAEROP" ? (
          <div style={{ marginTop: 22 }}>
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </>
  );
}
