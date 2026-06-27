import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { kstDateOf, labelDate } from "@/lib/date";

const SCOPES: { key: string; label: string; where: Prisma.OrderWhereInput }[] = [
  { key: "all", label: "전체", where: {} },
  { key: "hotdeal", label: "핫딜마켓", where: { user: { role: "MERCHANT_HOTDEAL" } } },
  { key: "seobu", label: "서부일광", where: { vendorRole: "VENDOR_SEOBU" } },
  { key: "jangheung", label: "장흥", where: { vendorRole: "VENDOR_JANGHEUNG" } },
  { key: "chaeumchae", label: "채움채", where: { vendorRole: "VENDOR_CHAEUMCHAE" } },
  { key: "saerop", label: "주식회사 새롭", where: { vendorRole: "ADMIN_SAEROP" } },
];

export default async function AdminOrders(props: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requireAdmin();
  const { scope = "all" } = await props.searchParams;
  const sel = SCOPES.find((s) => s.key === scope) ?? SCOPES[0];

  const orders = await prisma.order.findMany({
    where: sel.where,
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
  }[] = [];
  if (combined) {
    const map = new Map<string, (typeof groups)[number]>();
    for (const o of orders) {
      const d = kstDateOf(o.createdAt);
      const key = `${o.userId}__${d}`;
      let g = map.get(key);
      if (!g) {
        g = { userId: o.userId, store: o.user.storeName, date: d, cats: [], items: 0 };
        map.set(key, g);
        groups.push(g);
      }
      const c = o.category as Category;
      if (!g.cats.includes(c)) g.cats.push(c);
      g.items += o._count.items;
    }
    for (const g of groups)
      g.cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }

  return (
    <>
      <header className="topbar">
        <Link href="/admin" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">발주 목록</div>
      </header>
      <div className="page page--tight">
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

        {orders.length === 0 ? (
          <div className="empty">
            <p>발주가 없어요.</p>
          </div>
        ) : combined ? (
          <div className="list">
            {groups.map((g) => (
              <Link
                href={`/admin/combined/${g.userId}/${g.date}`}
                className="row"
                key={`${g.userId}-${g.date}`}
              >
                <div className="row__main">
                  <div className="row__title">{g.store}</div>
                  <div className="row__sub">
                    {labelDate(g.date)} ·{" "}
                    {g.cats.map((c) => CATEGORIES[c].label).join("·")} · 총 {g.items}건
                  </div>
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
                <Link href={`/admin/orders/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">{o.user.storeName}</div>
                    <div className="row__sub">
                      {formatKDateTime(o.createdAt)} · {cat.label} · {o._count.items}건
                    </div>
                  </div>
                  <span className="row__chev">›</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
