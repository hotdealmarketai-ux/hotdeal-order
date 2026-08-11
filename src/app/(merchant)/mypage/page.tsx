import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  CATEGORIES,
  CATEGORY_ORDER,
  receiverLabel,
  type Category,
} from "@/lib/constants";
import { formatKDate } from "@/lib/format";
import { kstDateOf, kstToday, labelDate, shipmentDayOf } from "@/lib/date";
import { receivableOf, receivableSadadreamOf } from "@/lib/receivable";
import { LogoutButton } from "@/components/LogoutButton";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function MyPage(props: {
  searchParams: Promise<{ saved?: string }>;
}) {
  const user = await requireMerchant();
  const { saved } = await props.searchParams;
  const isHotdeal = user.role === "MERCHANT_HOTDEAL";

  const [orders, weeklyOrders, reservationOrders, invoices, ar] =
    await Promise.all([
      prisma.order.findMany({
        where: { userId: user.id },
        include: { _count: { select: { items: true } } },
        orderBy: { createdAt: "desc" },
      }),
      // 주간·예약은 핫딜마켓 가맹점만 — 다른 role은 항상 빈 배열
      isHotdeal
        ? prisma.weeklyOrder.findMany({
            where: { userId: user.id },
            include: { _count: { select: { items: true } } },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      isHotdeal
        ? prisma.reservationOrder.findMany({
            // 실제로 예약한 것만(확정 + 품목 1개↑). 미확정·0건 행은 '지난 발주'에 안 뜨게.
            where: {
              userId: user.id,
              confirmed: true,
              items: { some: { qty: { gt: 0 } } },
            },
            include: {
              _count: { select: { items: true } },
              batch: { select: { pickupDate: true } },
            },
            orderBy: { createdAt: "desc" },
          })
        : Promise.resolve([]),
      prisma.invoice.findMany({
        // 날짜별 입금 배지용 — 사다드림(별도 트랙)은 일반 발주일 배지를 오염시키지 않게 제외.
        where: { userId: user.id, status: { in: ["ISSUED", "PAID"] }, kind: { not: "SADADREAM" } },
        select: { date: true, status: true },
      }),
      receivableOf(user.id),
    ]);
  // 날짜별 입금요청서 배지(ISSUED=입금요청, PAID=입금완료). 낱장 결제 여부는 매칭이 지점 단위라 알 수 없으므로
  // '지점 총미수'로만 판단(2026-08-05~): 미수가 남아 있으면 미입금 청구 날짜는 '입금 요청', 다 냈으면 '입금 완료'.
  // (레거시로 status가 PAID인 계산서 날짜는 그대로 '완료'. 낱장 추정 = 이중납부 위험이라 하지 않는다)
  const storePaid = ar.balance <= 0;
  const sdBal = (await receivableSadadreamOf(user.id)).balance; // 사다드림 미수(별도 트랙)
  const invByDate = new Map<string, "ISSUED" | "PAID">();
  for (const inv of invoices) {
    const st = inv.status === "PAID" || storePaid ? "PAID" : "ISSUED";
    if (invByDate.get(inv.date) === "ISSUED") continue; // '입금 요청'을 우선 표시
    invByDate.set(inv.date, st);
  }

  const today = kstToday();

  // 일반 발주 — 핫딜마켓은 날짜별로 묶고, 그 외는 건별
  const dayGroups: {
    date: string;
    cats: Category[];
    items: number;
    orders: number;
    confirmed: number;
    cancelled: number;
  }[] = [];
  if (isHotdeal) {
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
    for (const g of dayGroups)
      g.cats.sort((a, b) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b));
  }

  function dayBadge(date: string, base: React.ReactNode) {
    const inv = invByDate.get(date);
    if (inv === "PAID") return <span className="badge badge--ok">입금 완료</span>;
    if (inv === "ISSUED") return <span className="badge badge--danger">입금 요청</span>;
    return base;
  }

  // 지난 발주 통합(핫딜마켓): 일반 + 주간 + 예약을 한 목록으로, 최신순.
  type Hist = {
    key: string;
    sortDate: string;
    href: string;
    type: "일반" | "주간" | "예약";
    title: string;
    sub: string;
    badge: React.ReactNode;
  };
  const history: Hist[] = [];
  if (isHotdeal) {
    for (const g of dayGroups) {
      history.push({
        key: `d${g.date}`,
        sortDate: g.date,
        href: `/order/day/${g.date}`,
        type: "일반",
        title: labelDate(g.date),
        sub: `출고 ${labelDate(shipmentDayOf(g.date))} · ${g.cats.map((c) => CATEGORIES[c].label).join(" · ")} · 총 ${g.items}건`,
        badge:
          g.cancelled === g.orders && g.orders > 0 ? (
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
          ),
      });
    }
    for (const w of weeklyOrders) {
      history.push({
        key: `w${w.id}`,
        sortDate: kstDateOf(w.createdAt),
        href: "/weekly",
        type: "주간",
        title: `${labelDate(w.weekKey)} 주간발주`,
        sub: `항시품목 ${w._count.items}건`,
        badge: w.confirmed ? (
          <span className="badge badge--mute">준비 중</span>
        ) : (
          <span className="badge badge--mute">발주 요청</span>
        ),
      });
    }
    for (const r of reservationOrders) {
      history.push({
        key: `r${r.id}`,
        sortDate: kstDateOf(r.createdAt),
        href: `/reservations/${r.batchId}`,
        type: "예약",
        title: `픽업 ${labelDate(r.batch.pickupDate)}`,
        sub: `예약상품 ${r._count.items}건`,
        badge: r.confirmed ? (
          <span className="badge badge--mute">예약 확정</span>
        ) : (
          <span className="row__chev">›</span>
        ),
      });
    }
    history.sort((a, b) => b.sortDate.localeCompare(a.sortDate));
  }

  const hasHistory = isHotdeal ? history.length > 0 : orders.length > 0;

  return (
    <>
      <Topbar title="마이페이지" />
      <div className="page">
        {saved === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 저장되었어요.
          </div>
        )}

        {/* 입금요청서 — 맨 위, 브랜드 컬러 강조 */}
        <Link href="/invoices" className="paycard">
          <div className="paycard__main">
            <div className="paycard__title">입금요청서</div>
            <div className="paycard__sub">발행된 계산서·미수 확인</div>
          </div>
          <span className="paycard__amt">
            {ar.balance > 0 ? `${fmt(ar.balance)}원 ›` : "보기 ›"}
          </span>
        </Link>

        {/* 입출금내역 — 청구·입금·조정 통장식 내역(조회 전용) */}
        <Link
          href="/transactions"
          className="card"
          style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}
        >
          <span style={{ fontWeight: 700 }}>입출금내역</span>
          <span className="row__sub">청구·입금 내역 보기 ›</span>
        </Link>

        {sdBal > 0 && (
          <Link
            href="/invoices"
            className="card"
            style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", borderColor: "#2563eb" }}
          >
            <span className="row__sub" style={{ color: "#2563eb", fontWeight: 700 }}>
              사다드림 미수
            </span>
            <b style={{ color: "#2563eb", fontVariantNumeric: "tabular-nums" }}>{fmt(sdBal)}원 ›</b>
          </Link>
        )}

        <div className="card" style={{ marginTop: 16 }}>
          <div className="receipt__store">{user.storeName}</div>
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
          {ar.balance > 0 && (
            <div className="kv kv--strong kv--due">
              <span className="kv__k">미수 잔액</span>
              <span className="kv__v">{fmt(ar.balance)}원</span>
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <Link href="/mypage/edit" className="btn btn--ghost">
              프로필 수정
            </Link>
          </div>
        </div>

        <div className="section-label">지난 발주</div>
        {!hasHistory ? (
          <div className="empty">
            <p>아직 발주 내역이 없어요.</p>
          </div>
        ) : isHotdeal ? (
          <div className="list">
            {history.map((h) => (
              <Link href={h.href} className="row" key={h.key}>
                <div className="row__main">
                  <div className="row__title">
                    <span className={`histtype histtype--${h.type}`}>{h.type}</span>
                    {h.title}
                  </div>
                  <div className="row__sub">{h.sub}</div>
                </div>
                {h.badge}
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
                      {formatKDate(o.createdAt)} · 출고 {labelDate(shipmentDayOf(d))} ·{" "}
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

        <div style={{ marginTop: 22 }}>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
