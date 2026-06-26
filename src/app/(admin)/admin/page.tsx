import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { LogoutButton } from "@/components/LogoutButton";

export default async function AdminHome() {
  const user = await requireAdmin();

  const [pending, totalOrders, toolOrders, hotdealOrders] = await Promise.all([
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.order.count(),
    prisma.order.count({ where: { vendorRole: "ADMIN_SAEROP" } }),
    prisma.order.count({ where: { user: { role: "MERCHANT_HOTDEAL" } } }),
  ]);

  const menu = [
    {
      href: "/admin/approvals",
      title: "가입 승인",
      sub: pending > 0 ? `${pending}건 대기 중` : "대기 없음",
      badge: pending > 0 ? pending : undefined,
    },
    { href: "/admin/orders", title: "전체 발주", sub: `총 ${totalOrders}건` },
    {
      href: "/admin/orders?scope=hotdeal",
      title: "핫딜마켓 발주만 보기",
      sub: `${hotdealOrders}건`,
    },
    {
      href: "/admin/orders?scope=saerop",
      title: "공구 발주 (새롭 직접)",
      sub: `${toolOrders}건`,
    },
    { href: "/admin/inventory", title: "재고현황 작성", sub: "핫딜 가맹점에 노출" },
  ];

  return (
    <>
      <header className="topbar">
        <div className="brandmark">새롭 · 관리자</div>
        <div className="topbar__spacer" />
        <span className="chip">{user.storeName}</span>
      </header>
      <div className="page">
        <h1 className="h1">관리자</h1>
        <p className="lead">전체 발주를 확인하고 가맹점을 관리하세요.</p>

        <div className="list">
          {menu.map((m) => (
            <Link href={m.href} className="row" key={m.href}>
              <div className="row__main">
                <div className="row__title">{m.title}</div>
                <div className="row__sub">{m.sub}</div>
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
