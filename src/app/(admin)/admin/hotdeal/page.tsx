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
  kstDayRange,
  normalizeDateStr,
} from "@/lib/date";
import { DateBar } from "@/components/DateBar";
import { CancelRequestActions } from "@/components/CancelRequestActions";

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
  const date = normalizeDateStr(dateParam);
  const isToday = date === kstToday();
  const { start, end } = kstDayRange(date);

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
    for (const g of groups)
      g.cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }

  // #3 그룹별 계산서 상태 — 목록의 '계산서 작성/발행' 버튼 라벨·링크에 사용(발주취소는 발주서 안으로 이동).
  const invByKey = new Map<string, { id: string; status: string }>();
  if (combined && groups.length > 0) {
    const invs = await prisma.invoice.findMany({
      where: {
        userId: { in: [...new Set(groups.map((g) => g.userId))] },
        kind: "DAILY",
        date: { in: [...new Set(groups.map((g) => g.date))] },
        status: { not: "VOID" },
      },
      select: { id: true, userId: true, date: true, status: true },
    });
    for (const iv of invs)
      invByKey.set(`${iv.userId}__${iv.date}`, { id: iv.id, status: iv.status });
  }

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

        <p className="lead" style={{ marginTop: 0 }}>
          {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {orders.length}건
        </p>
        <DateBar date={date} basePath="/admin/hotdeal" query={`scope=${scope}`} />

        <Link
          href={`/admin/summary?ctx=hotdeal&scope=${scope}&date=${date}`}
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
                      {labelDate(g.date)} ·{" "}
                      {g.cats.map((c) => CATEGORIES[c].label).join("·")} · 총 {g.items}건
                    </div>
                  </Link>
                  {g.cancelReq ? (
                    <CancelRequestActions userId={g.userId} store={g.store} />
                  ) : (
                    (() => {
                      const inv = invByKey.get(`${g.userId}__${g.date}`);
                      const s = inv?.status;
                      const label = !s
                        ? "계산서 작성"
                        : s === "PAID"
                          ? "완납"
                          : s === "ISSUED"
                            ? "발행됨"
                            : "계산서 작성중";
                      const cls =
                        s === "DRAFT"
                          ? "btn btn--xs btn--warn" // 작성중 = 노랑
                          : s === "PAID" || s === "ISSUED"
                            ? "btn btn--xs btn--soft"
                            : "btn btn--xs btn--primary"; // 작성 = 초록
                      return (
                        <Link
                          href={
                            inv
                              ? `/admin/invoices/${inv.id}`
                              : `/admin/invoices/new?user=${g.userId}&date=${g.date}`
                          }
                          className={cls}
                          style={{ flexShrink: 0, whiteSpace: "nowrap" }}
                        >
                          {label}
                        </Link>
                      );
                    })()
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
