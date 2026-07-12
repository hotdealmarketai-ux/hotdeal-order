import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, kstDayRange } from "@/lib/date";
import { weeklyKeyAt } from "@/lib/weekly";
import { LogoutButton } from "@/components/LogoutButton";

export default async function AdminHome() {
  const user = await requireAdmin();

  // 발주 건수는 '오늘(KST)' 들어온 것만 집계
  const { start, end } = kstDayRange(kstToday());
  const today = { gte: start, lt: end };
  // 건수 = '오늘 주문한 점포 수'(중복 제거). 한 점포가 여러 종류를 넣어도 1로 계산.
  const [pending, allStores, hotdealStores, weeklyCount] = await Promise.all([
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.order.findMany({
      where: { createdAt: today, status: { not: "CANCELLED" } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.order.findMany({
      where: { user: { role: "MERCHANT_HOTDEAL" }, createdAt: today, status: { not: "CANCELLED" } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.weeklyOrder.count({ where: { weekKey: weeklyKeyAt() } }),
  ]);
  const totalOrders = allStores.length;
  const hotdealOrders = hotdealStores.length;

  const menu = [
    {
      href: "/admin/approvals",
      title: "가입 대기",
      badge: pending > 0 ? pending : undefined,
    },
    { href: "/admin/members", title: "회원 관리" },
    { href: "/admin/orders", title: "전체 발주 목록", sub: `${totalOrders}건` },
    { href: "/admin/hotdeal", title: "핫딜마켓 발주", sub: `${hotdealOrders}건` },
    {
      href: "/admin/weekly",
      title: "주간발주",
      badge: weeklyCount > 0 ? weeklyCount : undefined,
    },
    { href: "/admin/deposits", title: "입금 관리" },
    { href: "/admin/inventory", title: "재고" },
    { href: "/admin/audit", title: "로그 내역" },
  ];

  return (
    <>
      <Topbar brand="새롭 · 관리자" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <h1 className="h1">관리자</h1>
        <p className="lead">전체 발주를 확인하고 가맹점을 관리하세요.</p>

        <div className="admgrid">
          {menu.map((m) => (
            <Link href={m.href} className="admcard" key={m.href}>
              {m.badge ? <span className="admcard__badge">{m.badge}</span> : null}
              <div className="admcard__title">{m.title}</div>
              {m.sub ? <div className="admcard__sub">{m.sub}</div> : null}
            </Link>
          ))}
        </div>

        <div style={{ marginTop: 22 }}>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
