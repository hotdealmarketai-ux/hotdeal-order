import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";

const SCOPES: { key: string; label: string; where: Prisma.OrderWhereInput }[] = [
  { key: "all", label: "전체", where: {} },
  { key: "hotdeal", label: "핫딜마켓", where: { user: { role: "MERCHANT_HOTDEAL" } } },
  { key: "seobu", label: "서부일광", where: { vendorRole: "VENDOR_SEOBU" } },
  { key: "jangheung", label: "장흥", where: { vendorRole: "VENDOR_JANGHEUNG" } },
  { key: "chaeumchae", label: "채움채", where: { vendorRole: "VENDOR_CHAEUMCHAE" } },
  { key: "saerop", label: "공구(새롭)", where: { vendorRole: "ADMIN_SAEROP" } },
];

export default async function AdminOrders(props: {
  searchParams: Promise<{ scope?: string }>;
}) {
  await requireAdmin();
  const { scope = "all" } = await props.searchParams;
  const sel = SCOPES.find((s) => s.key === scope) ?? SCOPES[0];

  const orders = await prisma.order.findMany({
    where: sel.where,
    include: { user: true, _count: { select: { items: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <header className="topbar">
        <Link href="/admin" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">발주 목록</div>
      </header>
      <div className="page page--tight">
        <div className="cattabs">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={`/admin/orders?scope=${s.key}`}
              className={`cattab ${s.key === sel.key ? "is-active" : ""}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {orders.length === 0 ? (
          <div className="empty">
            <div className="empty__ic">📋</div>
            <p>발주가 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {orders.map((o) => {
              const cat = CATEGORIES[o.category as Category];
              return (
                <Link href={`/admin/orders/${o.id}`} className="row" key={o.id}>
                  <div className="row__main">
                    <div className="row__title">{o.user.storeName}</div>
                    <div className="row__sub">
                      {formatKDateTime(o.createdAt)} · {cat.icon}
                      {cat.label} → {cat.vendorLabel} · {o._count.items}건
                    </div>
                  </div>
                  <span className="row__chev">›</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
