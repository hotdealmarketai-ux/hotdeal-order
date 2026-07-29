import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { MarkAdminSeen } from "@/components/MarkAdminSeen";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  weeklyKeyAt,
  weeklyForceOpen,
  weeklyStatusOf,
  weeklyShipDow,
  weeklyShipmentDayForKey,
} from "@/lib/weekly";
import { isWeeklyOpen } from "@/lib/schedule";
import {
  setWeeklyForceOpenAction,
  setWeeklyShipDowAction,
} from "@/app/actions/weekly-invoice";
import { labelDateLong, labelDate, shiftDate } from "@/lib/date";
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
  const shipDow = await weeklyShipDow();
  const shipDay = weeklyShipmentDayForKey(weekKey, shipDow);

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
      <MarkAdminSeen surface="weekly" />
      <Topbar
        title="주간발주"
        right={
          <TopbarChip>
            {forceOpen || inWindow ? "주간발주 진행 중" : "주간발주 마감"}
          </TopbarChip>
        }
      />
      <div className="page">
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

        {/* 주간발주 출고 요일 — 토요일에 넣은 주간발주가 이 요일에 출고되고, 그 날 발주서(본사출고·핫딜마켓·전체)에 함께 실린다 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div
            style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}
          >
            <div style={{ fontWeight: 700 }}>주간발주 출고 요일</div>
            <span className="hint">이번 주 출고 {labelDate(shipDay)}</span>
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            {[1, 2, 3, 4, 5].map((d) => (
              <form action={setWeeklyShipDowAction} key={d} style={{ flex: 1 }}>
                <input type="hidden" name="dow" value={d} />
                <button
                  type="submit"
                  className={`btn btn--xs ${d === shipDow ? "btn--primary" : "btn--soft"}`}
                  style={{ width: "100%" }}
                >
                  {["", "월", "화", "수", "목", "금"][d]}
                </button>
              </form>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 8 }}>
            토요일에 넣은 주간발주가 이 요일에 출고돼요. 그 날 발주서에 함께 표시됩니다.
          </div>
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
