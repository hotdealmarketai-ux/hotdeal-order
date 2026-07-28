import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { MarkAdminSeen } from "@/components/MarkAdminSeen";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import {
  kstDateOf,
  labelDate,
  kstToday,
  normalizeDateStr,
  orderRangeForShipment,
  shipmentDayOf,
  shiftDate,
  dowOf,
} from "@/lib/date";
import { getReservationStoresForPickup } from "@/lib/reservation-data";
import { DateBar } from "@/components/DateBar";
import { CancelRequestActions } from "@/components/CancelRequestActions";
import { dailyForceOpen } from "@/lib/order-open";
import { isOrderOpen } from "@/lib/deadline";
import { setDailyForceOpenAction } from "@/app/actions/dev";

// 핫딜마켓 가맹점 발주를 '카테고리(보내는 곳)'별로.
const HOTDEAL = { user: { role: "MERCHANT_HOTDEAL" } } as const;
const SCOPES: { key: string; label: string; where: Prisma.OrderWhereInput }[] = [
  { key: "all", label: "전체발주", where: { ...HOTDEAL } },
  { key: "fruit", label: "과일발주", where: { ...HOTDEAL, category: "FRUIT" } },
  { key: "veg", label: "야채발주", where: { ...HOTDEAL, category: "VEG" } },
  { key: "tofu", label: "채움채", where: { ...HOTDEAL, category: "TOFU" } },
  { key: "tool", label: "공구발주", where: { ...HOTDEAL, category: "TOOL" } },
];

export default async function AdminHotdeal(props: {
  searchParams: Promise<{ scope?: string; date?: string }>;
}) {
  await requireAdmin();
  const { scope = "all", date: dateParam } = await props.searchParams;
  const sel = SCOPES.find((s) => s.key === scope) ?? SCOPES[0];
  // date = '출고일'. 이 날 출고할 발주(= 전날 발주, 월요일 출고는 토·일 발주)를 조회한다.
  const date = normalizeDateStr(dateParam);
  const isToday = date === kstToday();
  const isSunday = dowOf(date) === 0; // 일요일은 출고 없음
  const { start, end } = orderRangeForShipment(date);

  const orders = await prisma.order.findMany({
    where: { ...sel.where, createdAt: { gte: start, lt: end } },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  // 전체발주: 가맹점별·날짜별로 4종을 하나의 발주서로 묶음
  const combined = sel.key === "all";
  const groups: {
    userId: string;
    store: string;
    date: string;
    cats: Category[];
    items: number;
    total: number;
    cancelledCount: number;
    cancelReq: boolean;
    edited: boolean;
    resvCount: number; // 이 출고일 확정 공구 예약분 건수(발주 없이 예약만 있어도 표시)
  }[] = [];
  if (combined) {
    const map = new Map<string, (typeof groups)[number]>();
    for (const o of orders) {
      const d = kstDateOf(o.createdAt);
      const key = `${o.userId}__${d}`;
      let g = map.get(key);
      if (!g) {
        g = {
          userId: o.userId,
          store: o.user.storeName,
          date: d,
          cats: [],
          items: 0,
          total: 0,
          cancelledCount: 0,
          cancelReq: false,
          edited: false,
          resvCount: 0,
        };
        map.set(key, g);
        groups.push(g);
      }
      const c = o.category as Category;
      if (!g.cats.includes(c)) g.cats.push(c);
      g.items += o._count.items;
      g.total += 1;
      if (o.status === "CANCELLED") g.cancelledCount += 1;
      if (o.cancelRequested && o.status !== "CANCELLED") g.cancelReq = true;
      if (o.edited && !o.confirmed && o.status !== "CANCELLED") g.edited = true;
    }

    // 공구 예약분(픽업=출고일) 합류 — 발주 있는 점포엔 공구 종류·건수 추가,
    // 예약만 있는 점포는 합본 그룹을 새로 만든다(발주일=출고일−1로 링크).
    const resvStores = await getReservationStoresForPickup(date);
    const byUser = new Map(groups.map((g) => [g.userId, g]));
    for (const s of resvStores) {
      const g = byUser.get(s.userId);
      if (g) {
        if (!g.cats.includes("TOOL")) g.cats.push("TOOL");
        g.resvCount += s.count;
      } else {
        const ng = {
          userId: s.userId,
          store: s.storeName,
          date: shiftDate(date, -1),
          cats: ["TOOL"] as Category[],
          items: 0,
          total: 0,
          cancelledCount: 0,
          cancelReq: false,
          edited: false,
          resvCount: s.count,
        };
        groups.push(ng);
        byUser.set(s.userId, ng);
      }
    }

    for (const g of groups)
      g.cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }

  // 계산서 발행은 관리자 '계산서 발행' 메뉴(/admin/billing)로 일원화 — 이 목록에선 발주만 관리.
  // 일반발주 임시 오픈(개발/특례) — 운영시간이 아니어도 발주창을 연다.
  const forceOpen = await dailyForceOpen();
  const naturalOpen = isOrderOpen();

  return (
    <>
      <MarkAdminSeen surface="hotdeal" />
      <Topbar backHref="/admin" title="핫딜마켓 발주" />
      <div className="page page--tight">
        <div className="cattabs">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={`/admin/hotdeal?scope=${s.key}`}
              className={`cattab ${s.key === sel.key ? "is-active" : ""}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {/* 개발/특례용 — 일반발주 임시 오픈(운영시간 아니어도 발주 가능). 관리자만. */}
        <div className="pushcard" style={{ marginBottom: 12 }}>
          <div className="pushcard__main">
            <div className="pushcard__title">일반발주 임시 오픈</div>
            {(naturalOpen || forceOpen) && (
              <div className="pushcard__sub">
                {naturalOpen
                  ? "지금은 발주 시간이에요."
                  : "임시 오픈 중 — 지금 발주 가능"}
              </div>
            )}
          </div>
          <form action={setDailyForceOpenAction}>
            <input type="hidden" name="on" value={forceOpen ? "false" : "true"} />
            <button
              type="submit"
              role="switch"
              aria-checked={forceOpen || naturalOpen}
              aria-label="일반발주 임시 오픈"
              className={`switch ${forceOpen || naturalOpen ? "is-on" : ""}`}
              disabled={naturalOpen}
            >
              <span className="switch__knob" />
            </button>
          </form>
        </div>

        <p className="lead" style={{ marginTop: 0, marginBottom: 2 }}>
          출고 {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {orders.length}건
        </p>
        <DateBar
          date={date}
          basePath="/admin/hotdeal"
          query={`scope=${scope}`}
          labelPrefix="출고 "
          max={shipmentDayOf(kstToday())}
        />

        <Link
          href={`/admin/summary?ctx=hotdeal&scope=${scope}&date=${date}`}
          className="btn btn--primary"
          style={{ margin: "4px 0 16px" }}
        >
          발주 취합 보기
        </Link>

        {(combined ? groups.length === 0 : orders.length === 0) ? (
          <div className="empty">
            <p>
              {isSunday
                ? "일요일은 출고가 없어요. (토·일 발주는 월요일 출고)"
                : "이 날 출고할 발주가 없습니다."}
            </p>
          </div>
        ) : combined ? (
          <div className="list">
            {groups.map((g) => {
              const cancelled = g.total > 0 && g.cancelledCount === g.total;
              return (
                <div className="row" key={`${g.userId}-${g.date}`}>
                  <Link
                    href={`/admin/combined/${g.userId}/${g.date}`}
                    className="row__main"
                    style={{ textDecoration: "none" }}
                  >
                    <div className="row__title">
                      {g.store}
                      {cancelled ? (
                        <span className="badge badge--danger" style={{ marginLeft: 8 }}>
                          취소 완료
                        </span>
                      ) : g.cancelReq ? (
                        <span className="badge badge--req" style={{ marginLeft: 8 }}>
                          취소 요청
                        </span>
                      ) : g.edited ? (
                        <span className="badge badge--edit" style={{ marginLeft: 8 }}>
                          발주 수정
                        </span>
                      ) : null}
                    </div>
                    <div className="row__sub">
                      발주 {labelDate(g.date)} ·{" "}
                      {g.cats.map((c) => CATEGORIES[c].label).join("·")}
                      {g.items > 0 ? ` · 총 ${g.items}건` : ""}
                      {g.resvCount > 0 ? ` · 공구예약 ${g.resvCount}건` : ""}
                    </div>
                  </Link>
                  {g.cancelReq && (
                    <CancelRequestActions userId={g.userId} store={g.store} />
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="list">
            {orders.map((o) => {
              const cat = CATEGORIES[o.category as Category];
              return (
                <Link href={`/admin/orders/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">{o.user.storeName}</div>
                    <div className="row__sub">
                      {formatKDateTime(o.createdAt)} · {cat.label} · {o._count.items}건
                    </div>
                  </div>
                  {o.status === "CANCELLED" ? (
                    <span className="badge badge--danger">취소 완료</span>
                  ) : o.cancelRequested ? (
                    <span className="badge badge--req">취소 요청</span>
                  ) : o.edited && !o.confirmed ? (
                    <span className="badge badge--edit">발주 수정</span>
                  ) : (
                    <span className="row__chev">›</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
