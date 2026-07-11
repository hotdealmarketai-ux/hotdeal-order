import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  weeklyKeyAt,
  weeklyForceOpen,
  weeklyStatusOf,
} from "@/lib/weekly";
import { isWeeklyOpen } from "@/lib/schedule";
import { setWeeklyForceOpenAction } from "@/app/actions/weekly-invoice";
import { labelDateLong, shiftDate } from "@/lib/date";
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
  const forceOpen = await weeklyForceOpen();
  const inWindow = isWeeklyOpen();

  const orders = await prisma.weeklyOrder.findMany({
    where: { weekKey },
    include: {
      user: { select: { id: true, storeName: true } },
      items: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const invoices = await prisma.invoice.findMany({
    where: { kind: "WEEKLY", date: weekKey, status: { not: "VOID" } },
    select: { userId: true, status: true },
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
      <Topbar brand="핫딜오더" title="주간발주" />
      <div className="page">
        <h1 className="h1">주간발주</h1>

        {/* 달력식 주 이동 */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
            marginBottom: 14,
          }}
        >
          <Link href={`/admin/weekly?week=${shiftDate(weekKey, -7)}`} className="btn btn--xs btn--ghost">
            ‹ 지난주
          </Link>
          <span style={{ fontWeight: 800 }}>{labelDateLong(weekKey)}</span>
          <Link href={`/admin/weekly?week=${shiftDate(weekKey, 7)}`} className="btn btn--xs btn--ghost">
            다음주 ›
          </Link>
        </div>

        {/* 잠금해제(강제 오픈) 토글 + 상품 관리 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
          >
            <div style={{ fontWeight: 700 }}>주간발주 잠금해제</div>
            <form action={setWeeklyForceOpenAction}>
              <input type="hidden" name="on" value={forceOpen ? "false" : "true"} />
              <button
                type="submit"
                role="switch"
                aria-checked={forceOpen || inWindow}
                aria-label="주간발주 잠금해제"
                className={`switch ${forceOpen || inWindow ? "is-on" : ""}`}
                disabled={inWindow}
              >
                <span className="switch__knob" />
              </button>
            </form>
          </div>
          <Link
            href="/admin/weekly/prices"
            className="btn btn--xs btn--soft"
            style={{ width: "100%", marginTop: 10 }}
          >
            상품 관리
          </Link>
        </div>

        {totalStores === 0 ? (
          <div className="notice notice--mute">주간발주가 아직 없습니다.</div>
        ) : (
          <>
            {/* 총 집계 — 기본 닫힘, 열기/닫기 */}
            <details className="wagg">
              <summary className="wagg__sum">총 집계 ({byCat.reduce((n, g) => n + g.items.length, 0)}개 품목)</summary>
              <div style={{ marginTop: 10 }}>
                {byCat.map((g) => (
                  <div className="invcat" key={g.key}>
                    <div className="invcat__head">
                      <span className="chip">{g.label}</span>
                      <span className="invcat__sum">{g.items.length}개</span>
                    </div>
                    {g.items.map((a, i) => (
                      <div className="confitem" key={i}>
                        <span className="confitem__name">{a.name}</span>
                        <span className="confitem__qtytext">{a.qty}박스</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </details>

            <h2 className="h2" style={{ marginTop: 20 }}>
              주간발주 요청
            </h2>
            <div className="list">
              {orders.map((o) => {
                const inv = invByUser.get(o.user.id);
                const amount = o.items.reduce((n, it) => n + it.qty * it.unitPrice, 0);
                const st = weeklyStatusOf(o, inv ?? null);
                return (
                  <Link
                    href={`/admin/weekly/${o.user.id}?week=${weekKey}`}
                    className="row"
                    key={o.id}
                  >
                    <div className="row__main">
                      <div className="row__title">{o.user.storeName}</div>
                      <div className="row__sub">
                        {o.items.length}개 · {won(amount)}원
                      </div>
                    </div>
                    <span className={`badge ${st.cls}`}>{st.label}</span>
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
