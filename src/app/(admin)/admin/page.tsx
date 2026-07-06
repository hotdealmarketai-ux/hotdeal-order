import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, kstDayRange } from "@/lib/date";
import { LogoutButton } from "@/components/LogoutButton";

export default async function AdminHome() {
  const user = await requireAdmin();

  // 발주 건수는 '오늘(KST)' 들어온 것만 집계
  const { start, end } = kstDayRange(kstToday());
  const today = { gte: start, lt: end };
  // 건수 = '오늘 주문한 점포 수'(중복 제거). 한 점포가 여러 종류를 넣어도 1로 계산.
  const [pending, allStores, hotdealStores] = await Promise.all([
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.order.findMany({
      where: { createdAt: today },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.order.findMany({
      where: { user: { role: "MERCHANT_HOTDEAL" }, createdAt: today },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const totalOrders = allStores.length;
  const hotdealOrders = hotdealStores.length;

  const menu = [
    {
      href: "/admin/approvals",
      title: "가입 대기",
      sub: pending > 0 ? `${pending}건 대기 중` : "대기 없음",
      badge: pending > 0 ? pending : undefined,
    },
    { href: "/admin/members", title: "회원 관리", sub: "회원 조회·수정·정지" },
    { href: "/admin/orders", title: "전체 발주 목록", sub: `${totalOrders}건` },
    { href: "/admin/hotdeal", title: "핫딜마켓 발주관리", sub: `${hotdealOrders}건` },
    { href: "/admin/deposits", title: "입금 관리", sub: "오늘 입금 현황" },
    { href: "/admin/inventory", title: "재고", sub: "" },
  ];

  return (
    <>
      <Topbar brand="새롭 · 관리자" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <h1 className="h1">관리자</h1>
        <p className="lead">전체 발주를 확인하고 가맹점을 관리하세요.</p>

        <div className="list">
          {menu.map((m) => (
            <Link href={m.href} className="row" key={m.href}>
              <div className="row__main">
                <div className="row__title">{m.title}</div>
                {m.sub ? <div className="row__sub">{m.sub}</div> : null}
              </div>
              {m.badge ? (
                <span className="badge badge--wait">{m.badge}</span>
              ) : (
                <span className="row__chev">›</span>
              )}
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
