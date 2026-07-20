import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, kstDayRange } from "@/lib/date";
import { weeklyKeyAt } from "@/lib/weekly";
import { LogoutButton } from "@/components/LogoutButton";
import { getAdminSeen } from "@/lib/admin-seen";

export default async function AdminHome() {
  const user = await requireAdmin();

  // 발주 건수는 '오늘(KST)' 들어온 것만 집계
  const { start, end } = kstDayRange(kstToday());
  const today = { gte: start, lt: end };
  // #25 배지는 '마지막으로 본 시각 이후' 새로 들어온 것만 카운트(보면 사라짐).
  const [seenSignup, seenWeekly, seenHotdeal] = await Promise.all([
    getAdminSeen("signup"),
    getAdminSeen("weekly"),
    getAdminSeen("hotdeal"),
  ]);
  const gt = (d: Date | null) => (d ? { createdAt: { gt: d } } : {});
  // 건수 = '오늘 주문한 점포 수'(중복 제거). 한 점포가 여러 종류를 넣어도 1로 계산.
  const [pending, allStores, hotdealStores, hotdealNew, weeklyCount] =
    await Promise.all([
      // 가입대기: 본 시각 이후 새로 신청한 대기 회원 수
      prisma.user.count({ where: { status: "PENDING", ...gt(seenSignup) } }),
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
      // 핫딜마켓 발주: 오늘(today) 발주 중 '본 시각 이후' 새로 발주한 점포 수(배지).
      // today 범위와 seen 하한을 함께 AND — gt를 spread하면 createdAt 키가 덮여 today가 사라지므로 명시적으로 합친다.
      prisma.order.findMany({
        where: {
          user: { role: "MERCHANT_HOTDEAL" },
          status: { not: "CANCELLED" },
          createdAt: seenHotdeal ? { ...today, gt: seenHotdeal } : today,
        },
        select: { userId: true },
        distinct: ["userId"],
      }),
      // 주간발주: 이번 주 발주 중 본 시각 이후 새로 들어온 것
      prisma.weeklyOrder.count({
        where: { weekKey: weeklyKeyAt(), ...gt(seenWeekly) },
      }),
    ]);
  const totalOrders = allStores.length;
  const hotdealOrders = hotdealStores.length;
  const hotdealNewCount = hotdealNew.length;

  const menu = [
    {
      href: "/admin/approvals",
      title: "가입 대기",
      badge: pending > 0 ? pending : undefined,
    },
    { href: "/admin/members", title: "회원 관리" },
    { href: "/admin/orders", title: "전체 발주 목록", sub: `${totalOrders}건` },
    {
      href: "/admin/hotdeal",
      title: "핫딜마켓 발주",
      sub: `${hotdealOrders}건`,
      badge: hotdealNewCount > 0 ? hotdealNewCount : undefined,
    },
    {
      href: "/admin/weekly",
      title: "주간발주",
      badge: weeklyCount > 0 ? weeklyCount : undefined,
    },
    { href: "/admin/billing", title: "계산서 발행" },
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
