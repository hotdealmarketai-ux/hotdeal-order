import Link from "next/link";
import { Prisma } from "@prisma/client";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";

// 핫딜마켓 가맹점 발주를 '카테고리(보내는 곳)'별로.
// 과일→서부일광 / 야채→장흥 / 두부류→채움채 / 공구→새롭
const HOTDEAL = { user: { role: "MERCHANT_HOTDEAL" } } as const;
const SCOPES: { key: string; label: string; where: Prisma.OrderWhereInput }[] = [
  { key: "all", label: "전체발주", where: { ...HOTDEAL } },
  { key: "fruit", label: "과일발주", where: { ...HOTDEAL, category: "FRUIT" } },
  { key: "veg", label: "야채발주", where: { ...HOTDEAL, category: "VEG" } },
  { key: "tofu", label: "채움채", where: { ...HOTDEAL, category: "TOFU" } },
  { key: "tool", label: "공구발주", where: { ...HOTDEAL, category: "TOOL" } },
];

export default async function AdminHotdeal(props: {
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
        <div className="topbar__title">핫딜마켓 발주관리</div>
      </header>
      <div className="page page--tight">
        <div className="cattabs">
          {SCOPES.map((s) => (
            <Link
              key={s.key}
              href={`/admin/hotdeal?scope=${s.key}`}
              className={`cattab ${s.key === sel.key ? "is-active" : ""}`}
            >
              {s.label}
            </Link>
          ))}
        </div>

        {orders.length === 0 ? (
          <div className="empty">
            <p>해당 발주가 없어요.</p>
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
                      {formatKDateTime(o.createdAt)} · {cat.label} → {cat.vendorLabel} ·{" "}
                      {o._count.items}건
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
