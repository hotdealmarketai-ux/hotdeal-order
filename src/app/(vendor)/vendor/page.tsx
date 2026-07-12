import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, VENDOR_LABEL, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { normalizeDateStr, kstDayRange, labelDate, kstToday } from "@/lib/date";
import { LogoutButton } from "@/components/LogoutButton";
import { VendorDateBar } from "@/components/VendorDateBar";
import { PushToggle } from "@/components/PushToggle";

export default async function VendorPage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  const user = await requireVendor();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);
  const { start, end } = kstDayRange(date);
  const isToday = date === kstToday();

  const orders = await prisma.order.findMany({
    where: { vendorRole: user.role, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <Topbar
        title="들어온 발주"
        right={
          <>
            <TopbarChip>{VENDOR_LABEL[user.role] ?? user.storeName}</TopbarChip>
            <PushToggle variant="header" />
          </>
        }
      />
      <div className="page">
        <h1 className="h1">발주 목록</h1>
        <p className="lead">
          {labelDate(date)}
          {isToday ? " (오늘)" : ""} · {orders.length}건
        </p>

        <VendorDateBar date={date} />

        <Link
          href={`/vendor/summary?date=${date}`}
          className="btn btn--primary"
          style={{ marginBottom: 16 }}
        >
          {isToday ? "오늘 전체주문 집계 보기" : "이 날짜 전체주문 집계"}
        </Link>

        {orders.length === 0 ? (
          <div className="empty">
            <p>해당 날짜에 발주가 없습니다.</p>
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
