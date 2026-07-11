import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { weeklyKeyAt } from "@/lib/weekly";
import { labelDate } from "@/lib/date";
import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";

const won = (n: number) => n.toLocaleString("ko-KR");

export default async function AdminWeeklyPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : weeklyKeyAt();

  const orders = await prisma.weeklyOrder.findMany({
    where: { weekKey },
    include: {
      user: { select: { id: true, storeName: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 이번 주 WEEKLY 입금요청서(발행 여부/상태) 매핑
  const invoices = await prisma.invoice.findMany({
    where: { kind: "WEEKLY", date: weekKey, status: { not: "VOID" } },
    select: { userId: true, status: true, total: true },
  });
  const invByUser = new Map(invoices.map((i) => [i.userId, i]));

  // 총 집계 — 상품(code)별 박스 수 합산
  const agg = new Map<
    string,
    { category: string; name: string; boxUnit: string; qty: number }
  >();
  for (const o of orders) {
    for (const it of o.items) {
      const cur = agg.get(it.code);
      if (cur) cur.qty += it.qty;
      else
        agg.set(it.code, {
          category: it.category,
          name: it.name,
          boxUnit: it.boxUnit,
          qty: it.qty,
        });
    }
  }
  const byCat = WEEKLY_CATEGORIES.map((c) => ({
    label: c.label,
    key: c.key,
    items: [...agg.values()].filter((a) => a.category === c.key),
  })).filter((g) => g.items.length > 0);

  const totalStores = orders.length;

  return (
    <>
      <Topbar brand="핫딜오더" title="주간발주 수령" />
      <div className="page">
        <h1 className="h1">주간발주 · {labelDate(weekKey)}</h1>
        <p className="lead">
          지점 {totalStores}곳 · 이번 주 토요일 발주분. 총 집계는 거래처 발주용, 지점별은 입금요청서 발행용.
        </p>

        {totalStores === 0 ? (
          <div className="notice notice--mute">이번 주 주간발주가 아직 없어요.</div>
        ) : (
          <>
            <h2 className="h2" style={{ marginTop: 8 }}>
              총 집계 (거래처 발주용)
            </h2>
            {byCat.map((g) => (
              <div className="invcat" key={g.key}>
                <div className="invcat__head">
                  <span className="chip">{g.label}</span>
                  <span className="invcat__sum">{g.items.length}품목</span>
                </div>
                {g.items.map((a, i) => (
                  <div className="confitem" key={i}>
                    <span className="confitem__name">{a.name}</span>
                    <span className="confitem__qtytext">
                      {a.qty}박스{a.boxUnit ? ` · ${a.boxUnit}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            <h2 className="h2" style={{ marginTop: 20 }}>
              지점별 (입금요청서 발행)
            </h2>
            <div className="list">
              {orders.map((o) => {
                const inv = invByUser.get(o.user.id);
                const amount = o.items.reduce(
                  (n, it) => n + it.qty * it.unitPrice,
                  0,
                );
                return (
                  <Link
                    href={`/admin/weekly/${o.user.id}?week=${weekKey}`}
                    className="row"
                    key={o.id}
                  >
                    <div className="row__main">
                      <div className="row__title">{o.user.storeName}</div>
                      <div className="row__sub">
                        {o.items.length}품목 · 예상 {won(amount)}원
                      </div>
                    </div>
                    {inv ? (
                      <span
                        className={`badge ${inv.status === "PAID" ? "badge--ok" : "badge--wait"}`}
                      >
                        {inv.status === "PAID" ? "입금완료" : "발행됨"}
                      </span>
                    ) : (
                      <span className="badge badge--edit">요청서 발행</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}
