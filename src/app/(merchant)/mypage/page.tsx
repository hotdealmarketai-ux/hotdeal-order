import Link from "next/link";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, ROLE_LABEL, type Category } from "@/lib/constants";
import { formatKDate } from "@/lib/format";
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
            <div className="empty__ic">🧾</div>
            <p>아직 발주 내역이 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {orders.map((o) => {
              const cat = CATEGORIES[o.category as Category];
              return (
                <Link href={`/order/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">
                      {cat.icon} {cat.label} · {o._count.items}건
                    </div>
                    <div className="row__sub">
                      {formatKDate(o.createdAt)} · {cat.vendorLabel}
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
