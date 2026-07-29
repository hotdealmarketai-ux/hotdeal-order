import Link from "next/link";
import { Topbar } from "@/components/Topbar";
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
import { getWeeklyStoresForShipment } from "@/lib/weekly";
import { DateBar } from "@/components/DateBar";
import { ResetOrdersButton } from "@/components/ResetOrdersButton";

const SCOPES: { key: string; label: string; where: Prisma.OrderWhereInput }[] = [
  { key: "all", label: "전체", where: {} },
  { key: "hotdeal", label: "핫딜마켓", where: { user: { role: "MERCHANT_HOTDEAL" } } },
  { key: "seobu", label: "서부일광", where: { vendorRole: "VENDOR_SEOBU" } },
  { key: "jangheung", label: "조은팜", where: { vendorRole: "VENDOR_JANGHEUNG" } },
  { key: "chaeumchae", label: "채움채", where: { vendorRole: "VENDOR_CHAEUMCHAE" } },
  { key: "saerop", label: "주식회사 새롭", where: { vendorRole: "ADMIN_SAEROP" } },
];

export default async function AdminOrders(props: {
  searchParams: Promise<{ scope?: string; date?: string; reset?: string }>;
}) {
  await requireAdmin();
  const { scope = "all", date: dateParam, reset } = await props.searchParams;
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

  // 핫딜마켓 탭: 가맹점별·날짜별로 4종을 하나의 발주서로 합본
  const combined = sel.key === "hotdeal";
  // 주간발주 출고분(출고 요일이면) — 핫딜마켓 합본 목록에 합류.
  const weeklyStores = combined ? await getWeeklyStoresForShipment(date) : [];
  const groups: {
    userId: string;
    store: string;
    date: string;
    cats: Category[];
    items: number;
    total: number;
    cancelledCount: number;
    weeklyCount: number;
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
          weeklyCount: 0,
        };
        map.set(key, g);
        groups.push(g);
      }
      const c = o.category as Category;
      if (!g.cats.includes(c)) g.cats.push(c);
      g.items += o._count.items;
      g.total += 1;
      if (o.status === "CANCELLED") g.cancelledCount += 1;
    }
    // 주간발주만 있는 점포는 합본 그룹을 새로 만든다(발주일=출고일−1로 링크).
    const byUser = new Map(groups.map((g) => [g.userId, g]));
    for (const s of weeklyStores) {
      const g = byUser.get(s.userId);
      if (g) {
        g.weeklyCount += s.count;
      } else {
        const ng = {
          userId: s.userId,
          store: s.storeName,
          date: shiftDate(date, -1),
          cats: [] as Category[],
          items: 0,
          total: 0,
          cancelledCount: 0,
          weeklyCount: s.count,
        };
        groups.push(ng);
        byUser.set(s.userId, ng);
      }
    }
    for (const g of groups)
      g.cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }

  return (
    <>
      <Topbar backHref="/admin" title="발주 목록" right={<ResetOrdersButton />} />
      <div className="page page--tight">
        {reset !== undefined && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            ✓ 전체 발주 {reset}건을 초기화했습니다.
          </div>
        )}

        <div className="cattabs">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={`/admin/orders?scope=${s.key}`}
              className={`cattab ${s.key === sel.key ? "is-active" : ""}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        <p className="lead" style={{ marginTop: 0, marginBottom: 2 }}>
          출고 {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {orders.length}건
        </p>
        <DateBar
          date={date}
          basePath="/admin/orders"
          query={`scope=${scope}`}
          labelPrefix="출고 "
          max={shipmentDayOf(kstToday())}
        />

        <Link
          href={`/admin/summary?ctx=orders&scope=${scope}&date=${date}`}
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
                <Link
                  href={`/admin/combined/${g.userId}/${g.date}`}
                  className="row"
                  key={`${g.userId}-${g.date}`}
                >
                  <div className="row__main">
                    <div className="row__title">
                      {g.store}
                      {cancelled && (
                        <span className="badge badge--danger" style={{ marginLeft: 8 }}>
                          취소 완료
                        </span>
                      )}
                    </div>
                    <div className="row__sub">
                      발주 {labelDate(g.date)}
                      {g.cats.length > 0
                        ? ` · ${g.cats.map((c) => CATEGORIES[c].label).join("·")}`
                        : ""}
                      {g.items > 0 ? ` · 총 ${g.items}건` : ""}
                      {g.weeklyCount > 0 ? ` · 주간발주 ${g.weeklyCount}건` : ""}
                    </div>
                  </div>
                  <span className="row__chev">›</span>
                </Link>
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
