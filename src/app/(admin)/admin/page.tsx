import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, kstDayRange } from "@/lib/date";
import { weeklyKeyAt } from "@/lib/weekly";
import { LogoutButton } from "@/components/LogoutButton";
import { ClosingCard } from "@/components/ClosingCard";
import { MaintenanceToggleCard } from "@/components/MaintenanceToggleCard";
import { maintenanceOn } from "@/lib/maintenance";
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
  const maintOn = await maintenanceOn(); // 패치(유지보수) 모드 현재 상태 — 회원·시스템 그룹 '패치' 토글

  // 관리자 홈 = 4개 그룹 섹션(발주·주문 / 정산·입금 / 재고·창고 / 회원·시스템).
  // 발주·주문 맨 위 두 항목(전체 발주 목록·핫딜마켓 발주)은 '오늘 건수'를 큰 숫자로 보여주는 KPI 타일.
  type Kpi = { href: string; title: string; value: number; fill?: boolean; badge?: number };
  type Item = { href: string; title: string; badge?: number };
  type Group = {
    label: string;
    kpis?: Kpi[];
    items: Item[];
    closing?: boolean;
    patch?: boolean;
  };
  const groups: Group[] = [
    {
      label: "발주 · 주문",
      kpis: [
        { href: "/admin/orders", title: "전체 발주 목록", value: totalOrders, fill: true },
        {
          href: "/admin/hotdeal",
          title: "핫딜마켓 발주",
          value: hotdealOrders,
          fill: true,
          badge: hotdealNewCount > 0 ? hotdealNewCount : undefined,
        },
      ],
      items: [
        { href: "/admin/weekly", title: "주간발주", badge: weeklyCount > 0 ? weeklyCount : undefined },
        { href: "/admin/calendar", title: "예약 달력" },
        { href: "/admin/holds", title: "담기 현황" },
        { href: "/admin/shipments", title: "송장 관리" },
      ],
    },
    {
      label: "정산 · 입금",
      items: [
        { href: "/admin/deposits", title: "입금 관리" },
        { href: "/admin/billing", title: "계산서 발행" },
      ],
      closing: true, // 마감 백업(ClosingCard) = 시트 확인창 카드, 이 그룹 끝에 렌더
    },
    {
      label: "재고 · 창고",
      items: [
        { href: "/admin/inbound", title: "입고" },
        { href: "/admin/inventory", title: "재고" },
        { href: "/admin/stock-reconcile", title: "재고 마감" },
        { href: "/warehouse", title: "창고 관리" },
      ],
    },
    {
      label: "회원 · 시스템",
      items: [
        { href: "/admin/approvals", title: "가입 대기", badge: pending > 0 ? pending : undefined },
        { href: "/admin/members", title: "회원 관리" },
        { href: "/admin/audit", title: "로그" },
      ],
      patch: true, // 패치(유지보수) 토글 카드 = 로그 옆, 이 그룹 끝에 렌더
    },
  ];

  return (
    <>
      <Topbar brand="새롭 · 관리자" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <div className="admhome">
          {groups.map((g) => {
            const count =
              (g.kpis?.length ?? 0) +
              g.items.length +
              (g.closing ? 1 : 0) +
              (g.patch ? 1 : 0);
            return (
              <section className="admsec" key={g.label}>
                <div className="admsec__head">
                  <span className="admsec__label">{g.label}</span>
                  <span className="admsec__count">{count}</span>
                </div>
                {g.kpis && g.kpis.length > 0 ? (
                  <div className="admgrid">
                    {g.kpis.map((k) => (
                      <Link
                        href={k.href}
                        key={k.href}
                        className={`admkpi${k.fill ? " admkpi--fill" : ""}`}
                      >
                        <div className="admkpi__label">
                          <span className="admkpi__name">{k.title}</span>
                          {k.badge ? (
                            <span className="admkpi__badge">{k.badge}</span>
                          ) : null}
                        </div>
                        <div className="admkpi__value">
                          <b>{k.value}</b>
                          <span>건</span>
                        </div>
                      </Link>
                    ))}
                  </div>
                ) : null}
                <div className="admgrid">
                  {g.items.map((m) => (
                    <Link href={m.href} className="admcard" key={m.href}>
                      {m.badge ? (
                        <span className="admcard__badge">{m.badge}</span>
                      ) : null}
                      <div className="admcard__title">{m.title}</div>
                    </Link>
                  ))}
                  {g.closing ? <ClosingCard /> : null}
                  {g.patch ? <MaintenanceToggleCard on={maintOn} /> : null}
                </div>
              </section>
            );
          })}
        </div>

        <div style={{ marginTop: 22 }}>
          <LogoutButton />
        </div>
      </div>
    </>
  );
}
