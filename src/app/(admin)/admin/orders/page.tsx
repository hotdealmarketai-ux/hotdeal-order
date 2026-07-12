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
  kstDayRange,
  normalizeDateStr,
} from "@/lib/date";
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
  const date = normalizeDateStr(dateParam);
  const isToday = date === kstToday();
  const { start, end } = kstDayRange(date);

  const orders = await prisma.order.findMany({
    where: { ...sel.where, createdAt: { gte: start, lt: end } },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    take: 400,
  });

  // 핫딜마켓 탭: 가맹점별·날짜별로 4종을 하나의 발주서로 합본
  const combined = sel.key === "hotdeal";
  const groups: {
    userId: string;
    store: string;
    date: string;
    cats: Category[];
    items: number;
    total: number;
    cancelledCount: number;
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

        <p className="lead" style={{ marginTop: 0 }}>
          {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {orders.length}건
        </p>
        <DateBar date={date} basePath="/admin/orders" query={`scope=${scope}`} />

        <Link
          href={`/admin/summary?ctx=orders&scope=${scope}&date=${date}`}
          className="btn btn--primary"
          style={{ margin: "4px 0 16px" }}
        >
          발주 취합 보기
        </Link>

        {orders.length === 0 ? (
          <div className="empty">
            <p>해당 날짜에 발주가 없습니다.</p>
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
                      {labelDate(g.date)} ·{" "}
                      {g.cats.map((c) => CATEGORIES[c].label).join("·")} · 총 {g.items}건
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
