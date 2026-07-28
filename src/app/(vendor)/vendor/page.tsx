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
import { getReservationStoresForPickup } from "@/lib/reservation-data";

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
  // 새롭 본사 출고 = 공구(ADMIN_SAEROP) + 채움채(VENDOR_CHAEUMCHAE)를 지점별로 하나로 묶어 본다.
  const isSaerop = user.role === "ADMIN_SAEROP";

  const vendorRoles = isSaerop
    ? ["ADMIN_SAEROP", "VENDOR_CHAEUMCHAE"]
    : [user.role];

  const orders = await prisma.order.findMany({
    where: { vendorRole: { in: vendorRoles }, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  // 공구 벤더(새롭)만: 이 출고일 확정 예약분(픽업=출고일).
  const resvStores = isSaerop ? await getReservationStoresForPickup(date) : [];

  // ── 본사 출고: 지점별로 1행(공구+채움채+예약분 통합). 딱 지점명만. ──
  const storeRows = (() => {
    if (!isSaerop) return [];
    const m = new Map<string, string>(); // userId -> storeName
    for (const o of orders) m.set(o.userId, o.user.storeName);
    for (const s of resvStores) if (!m.has(s.userId)) m.set(s.userId, s.storeName);
    return [...m.entries()]
      .map(([userId, storeName]) => ({ userId, storeName }))
      .sort((a, b) => a.storeName.localeCompare(b.storeName, "ko"));
  })();

  const nothing = isSaerop ? storeRows.length === 0 : orders.length === 0;

  return (
    <>
      <Topbar
        title="들어온 발주"
        right={<TopbarChip>{VENDOR_LABEL[user.role] ?? user.storeName}</TopbarChip>}
      />
      <div className="page">
        {isSaerop ? (
          <h1 className="h1" style={{ textAlign: "center" }}>발주 목록</h1>
        ) : (
          <>
            <h1 className="h1">발주 목록</h1>
            <p className="lead" style={{ marginBottom: 2 }}>
              출고 {labelDate(date)}
              {isToday ? " (오늘)" : ""} · {orders.length}건
            </p>
          </>
        )}

        <div style={{ marginTop: isSaerop ? 18 : 0 }}>
          <VendorDateBar
            date={date}
            labelPrefix="출고 "
            max={shipmentDayOf(kstToday())}
          />
        </div>

        <Link
          href={`/vendor/summary?date=${date}`}
          className="btn btn--primary"
          style={{ marginBottom: 16 }}
        >
          {isSaerop ? "집계" : isToday ? "오늘 전체주문 집계 보기" : "이 날짜 전체주문 집계"}
        </Link>

        {nothing ? (
          <div className="empty">
            <p>
              {isSunday
                ? "일요일은 출고가 없어요. (토·일 발주는 월요일 출고)"
                : "이 날 출고할 발주가 없습니다."}
            </p>
          </div>
        ) : isSaerop ? (
          // 본사 출고 — 지점명만, 핑퐁 지브라, 화살표만. 눌러서 통합 발주서로.
          <div className="list vstorelist">
            {storeRows.map((s) => (
              <Link
                href={`/vendor/store/${s.userId}?date=${date}`}
                className="row"
                key={s.userId}
              >
                <div className="row__main">
                  <div className="row__title">{s.storeName}</div>
                </div>
                <span className="row__chev">›</span>
              </Link>
            ))}
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

        {user.role !== "ADMIN_SAEROP" ? (
          <div style={{ marginTop: 22 }}>
            <LogoutButton />
          </div>
        ) : null}
      </div>
    </>
  );
}
