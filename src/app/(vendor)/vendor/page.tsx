import Link from "next/link";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, VENDOR_LABEL, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { LogoutButton } from "@/components/LogoutButton";

export default async function VendorPage() {
  const user = await requireVendor();

  const orders = await prisma.order.findMany({
    where: { vendorRole: user.role },
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <>
      <header className="topbar">
        <div className="topbar__title">들어온 발주</div>
        <div className="topbar__spacer" />
        <span className="chip">{VENDOR_LABEL[user.role] ?? user.storeName}</span>
      </header>
      <div className="page">
        <h1 className="h1">발주 목록</h1>
        <p className="lead">발주를 눌러 상세 발주서를 확인하세요.</p>

        {orders.length === 0 ? (
          <div className="empty">
            <p>아직 들어온 발주가 없어요.</p>
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
                  <span className="row__chev">›</span>
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
