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

  const orders = await prisma.order.findMany({
    where: { vendorRole: user.role, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  // 공구 벤더(새롭)만: 이 출고일 확정 예약분. 발주 있는 점포는 그 행에 예약분을 함께 표시하고,
  // 발주가 '없는'(예약전용) 점포는 별도 행으로 목록에 띄운다(창고 준비 누락 방지).
  const orderUserIds = new Set(orders.map((o) => o.userId));
  const resvStores =
    user.role === "ADMIN_SAEROP" ? await getReservationStoresForPickup(date) : [];
  const resvByUser = new Map(resvStores.map((s) => [s.userId, s]));
  const resvOnly = resvStores.filter((s) => !orderUserIds.has(s.userId));
  // 같은 점포에 발주가 여러 건이어도 예약분은 첫 행에만 한 번 표시(중복/합산 오해 방지).
  const resvRowIds = new Set<string>();
  const seenResv = new Set<string>();
  for (const o of orders) {
    if (!seenResv.has(o.userId) && resvByUser.has(o.userId)) resvRowIds.add(o.id);
    seenResv.add(o.userId);
  }
  const nothing = orders.length === 0 && resvOnly.length === 0;

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

        {nothing ? (
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
                      {resvRowIds.has(o.id)
                        ? ` · 예약분 ${resvByUser.get(o.userId)!.count}건`
                        : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    {resvRowIds.has(o.id) && (
                      <span className="badge badge--ai">예약</span>
                    )}
                    {o.edited && !o.confirmed ? (
                      <span className="badge badge--edit">발주 수정</span>
                    ) : o.confirmed ? (
                      <span className="badge badge--ok">발주 확인</span>
                    ) : (
                      <span className="row__chev">›</span>
                    )}
                  </div>
                </Link>
              );
            })}
            {/* 예약분만 있는 점포(공구 담기 발주 없음) — 예약 발주서로 진입 */}
            {resvOnly.map((s) => (
              <Link
                href={`/vendor/reservation/${s.userId}?date=${date}`}
                className="row"
                key={`resv-${s.userId}`}
              >
                <div className="row__main">
                  <div className="row__title">{s.storeName}</div>
                  <div className="row__sub">공구 예약분 {s.count}건</div>
                </div>
                <span className="badge badge--ai">예약</span>
              </Link>
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
