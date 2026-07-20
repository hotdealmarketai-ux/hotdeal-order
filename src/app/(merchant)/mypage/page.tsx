import Link from "next/link";
import { Topbar } from "@/components/Topbar";
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
import { receivableOf } from "@/lib/receivable";
import { LogoutButton } from "@/components/LogoutButton";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function MyPage(props: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireMerchant();
  const { saved } = await props.searchParams;

  const [orders, invoices, ar] = await Promise.all([
    prisma.order.findMany({
      where: { userId: user.id },
      include: { _count: { select: { items: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.invoice.findMany({
      where: { userId: user.id, status: { in: ["ISSUED", "PAID"] } },
      select: { date: true, status: true },
    }),
    receivableOf(user.id),
  ]);

  // 날짜별 입금요청서 상태 (ISSUED=입금요청, PAID=입금완료)
  const invByDate = new Map<string, "ISSUED" | "PAID">();
  for (const inv of invoices) {
    invByDate.set(inv.date, inv.status as "ISSUED" | "PAID");
  }

  const today = kstToday();
  const groupByDate = user.role === "MERCHANT_HOTDEAL";
  const dayGroups: {
    date: string;
    cats: Category[];
    items: number;
    orders: number;
    confirmed: number;
    cancelled: number;
  }[] = [];
  if (groupByDate) {
    const map = new Map<string, (typeof dayGroups)[number]>();
    for (const o of orders) {
      const d = kstDateOf(o.createdAt);
      let g = map.get(d);
      if (!g) {
        g = { date: d, cats: [], items: 0, orders: 0, confirmed: 0, cancelled: 0 };
        map.set(d, g);
        dayGroups.push(g);
      }
      const c = o.category as Category;
      if (!g.cats.includes(c)) g.cats.push(c);
      g.items += o._count.items;
      g.orders += 1;
      if (o.confirmed) g.confirmed += 1;
      if (o.status === "CANCELLED") g.cancelled += 1;
    }
    for (const g of dayGroups) {
      g.cats.sort(
        (a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
      );
    }
  }

  // 발주 상태 배지 — 입금요청/완료가 있으면 우선 표시
  function dayBadge(date: string, base: React.ReactNode) {
    const inv = invByDate.get(date);
    if (inv === "PAID") return <span className="badge badge--ok">입금 완료</span>;
    if (inv === "ISSUED")
      return <span className="badge badge--danger">입금 요청</span>;
    return base;
  }

  return (
    <>
      <Topbar title="마이페이지" />
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
            <span className="kv__k">주소</span>
            <span className="kv__v">{user.address}</span>
          </div>
          <div className={`kv kv--strong ${ar.balance > 0 ? "kv--due" : ""}`}>
            <span className="kv__k">미수 잔액</span>
            <span className="kv__v">
              {ar.balance > 0 ? `${fmt(ar.balance)}원` : "0원"}
            </span>
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
              <Link href={`/order/day/${g.date}`} className="row" key={g.date}>
                <div className="row__main">
                  <div className="row__title">{labelDate(g.date)}</div>
                  <div className="row__sub">
                    {g.cats.map((c) => CATEGORIES[c].label).join(" · ")} · 총{" "}
                    {g.items}건
                  </div>
                </div>
                {g.cancelled === g.orders && g.orders > 0 ? (
                  <span className="badge badge--danger">취소 완료</span>
                ) : (
                  dayBadge(
                    g.date,
                    g.date < today ? (
                      <span className="badge badge--ok">완료</span>
                    ) : g.confirmed >= g.orders ? (
                      <span className="badge badge--mute">준비 중</span>
                    ) : g.confirmed > 0 ? (
                      <span className="badge badge--mute">일부 확인</span>
                    ) : (
                      <span className="row__chev">›</span>
                    ),
                  )
                )}
              </Link>
            ))}
          </div>
        ) : (
          <div className="list">
            {orders.map((o) => {
              const cat = CATEGORIES[o.category as Category];
              const d = kstDateOf(o.createdAt);
              return (
                <Link href={`/order/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">
                      {cat.label} · {o._count.items}건
                    </div>
                    <div className="row__sub">
                      {formatKDate(o.createdAt)} ·{" "}
                      {receiverLabel(o.category as Category, user.role)}
                    </div>
                  </div>
                  {o.status === "CANCELLED" ? (
                    <span className="badge badge--danger">취소 완료</span>
                  ) : (
                    dayBadge(
                      d,
                      d < today ? (
                        <span className="badge badge--ok">완료</span>
                      ) : o.confirmed ? (
                        <span className="badge badge--mute">준비 중</span>
                      ) : (
                        <span className="row__chev">›</span>
                      ),
                    )
                  )}
                </Link>
              );
            })}
          </div>
        )}

        <Link
          href="/invoices"
          className="card"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            marginTop: 16,
            textDecoration: "none",
            color: "inherit",
          }}
        >
          <div>
            <div style={{ fontWeight: 800, fontSize: 15.5 }}>입금요청서</div>
            <div className="row__sub" style={{ marginTop: 2 }}>
              발행된 계산서·미수 모두 여기서 확인
            </div>
          </div>
          <span style={{ color: "var(--green-700)", fontWeight: 800 }}>
            {ar.balance > 0 ? `${fmt(ar.balance)}원 ›` : "보기 ›"}
          </span>
        </Link>

        <div style={{ marginTop: 22 }}>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
