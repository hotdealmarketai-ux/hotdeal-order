import Link from "next/link";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  receiverLabel,
  ROLE_LABEL,
  type Category,
} from "@/lib/constants";
import { formatKDate } from "@/lib/format";
import { kstDateOf, kstToday, labelDate } from "@/lib/date";
import { LogoutButton } from "@/components/LogoutButton";

export default async function MyPage(props: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireMerchant();
  const { saved } = await props.searchParams;

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  // 발주일이 오늘 이전이면 마감이 지난 것 → '완료'로 표시
  const today = kstToday();

  // 핫딜마켓 가맹점은 한 번에 4종을 발주하므로 '발주한 날짜'로 묶어서 보여준다
  const groupByDate = user.role === "MERCHANT_HOTDEAL";
  const dayGroups: {
    date: string;
    cats: Category[];
    items: number;
    orders: number;
    confirmed: number;
  }[] = [];
  if (groupByDate) {
    const map = new Map<string, (typeof dayGroups)[number]>();
    for (const o of orders) {
      const d = kstDateOf(o.createdAt);
      let g = map.get(d);
      if (!g) {
        g = { date: d, cats: [], items: 0, orders: 0, confirmed: 0 };
        map.set(d, g);
        dayGroups.push(g);
      }
      const c = o.category as Category;
      if (!g.cats.includes(c)) g.cats.push(c);
      g.items += o._count.items;
      g.orders += 1;
      if (o.confirmed) g.confirmed += 1;
    }
    for (const g of dayGroups) {
      g.cats.sort(
        (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
      );
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar__title">마이페이지</div>
      </header>
      <div className="page">
        {saved === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 저장되었어요.
          </div>
        )}

        <div className="card">
          <div className="receipt__store">{user.storeName}</div>
          <div className="receipt__meta" style={{ marginTop: 4 }}>
            {ROLE_LABEL[user.role]}
          </div>
          <div className="divider" />
          <div className="kv">
            <span className="kv__k">아이디</span>
            <span className="kv__v">{user.username}</span>
          </div>
          <div className="kv">
            <span className="kv__k">연락처</span>
            <span className="kv__v">{user.phone}</span>
          </div>
          <div className="kv">
            <span className="kv__k">소재지</span>
            <span className="kv__v">{user.address}</span>
          </div>
          <div style={{ marginTop: 14 }}>
            <Link href="/mypage/edit" className="btn btn--ghost">
              프로필 수정
            </Link>
          </div>
        </div>

        <div className="section-label">지난 발주</div>
        {orders.length === 0 ? (
          <div className="empty">
            <p>아직 발주 내역이 없어요.</p>
          </div>
        ) : groupByDate ? (
          <div className="list">
            {dayGroups.map((g) => (
              <Link
                href={`/order/day/${g.date}`}
                className="row"
                key={g.date}
              >
                <div className="row__main">
                  <div className="row__title">{labelDate(g.date)}</div>
                  <div className="row__sub">
                    {g.cats.map((c) => CATEGORIES[c].label).join(" · ")} · 총{" "}
                    {g.items}건
                  </div>
                </div>
                {g.date < today ? (
                  <span className="badge badge--ok">완료</span>
                ) : g.confirmed >= g.orders ? (
                  <span className="badge badge--ok">준비 중</span>
                ) : g.confirmed > 0 ? (
                  <span className="badge badge--mute">일부 확인</span>
                ) : (
                  <span className="row__chev">›</span>
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="list">
            {orders.map((o) => {
              const cat = CATEGORIES[o.category as Category];
              return (
                <Link href={`/order/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">
                      {cat.label} · {o._count.items}건
                    </div>
                    <div className="row__sub">
                      {formatKDate(o.createdAt)} · {receiverLabel(o.category as Category, user.role)}
                    </div>
                  </div>
                  {kstDateOf(o.createdAt) < today ? (
                    <span className="badge badge--ok">완료</span>
                  ) : o.confirmed ? (
                    <span className="badge badge--ok">준비 중</span>
                  ) : (
                    <span className="row__chev">›</span>
                  )}
                </Link>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 22 }}>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
