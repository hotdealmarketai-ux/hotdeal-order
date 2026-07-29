import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, shiftDate, dowOf } from "@/lib/date";

export const dynamic = "force-dynamic";

const MONTH_RE = /^\d{4}-\d{2}$/;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

function monthLabel(m: string): string {
  const [y, mo] = m.split("-");
  return `${y}년 ${Number(mo)}월`;
}

// 예약 픽업 달력 — 예약발주에서 등록한 '수기 예약상품(재고 연동 아님)'을 픽업일자별로 표시.
export default async function AdminCalendarPage(props: {
  searchParams: Promise<{ m?: string }>;
}) {
  await requireAdmin();
  const { m } = await props.searchParams;
  const today = kstToday();
  const month = m && MONTH_RE.test(m) ? m : today.slice(0, 7);

  // 이 달의 1일이 걸린 주의 일요일부터 6주(42칸) 그리드.
  const first = `${month}-01`;
  const gridStart = shiftDate(first, -dowOf(first));
  const cells = Array.from({ length: 42 }, (_, i) => shiftDate(gridStart, i));
  const gridEnd = cells[cells.length - 1];

  // 수기 예약상품만(inventoryItemId 빈값 = 재고 연동 아님) · 활성 배치 · 그리드 범위 픽업일.
  const products = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      inventoryItemId: "",
      batch: { active: true },
      pickupDate: { gte: gridStart, lte: gridEnd },
    },
    orderBy: [{ pickupDate: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { name: true, pickupDate: true },
  });
  const byDate = new Map<string, string[]>();
  for (const p of products) {
    if (!p.pickupDate) continue;
    const list = byDate.get(p.pickupDate) ?? [];
    list.push(p.name);
    byDate.set(p.pickupDate, list);
  }

  const prevMonth = shiftDate(first, -1).slice(0, 7); // 전월 말일 → 전월
  const nextMonth = shiftDate(first, 32).slice(0, 7); // 1일+32일 → 항상 다음달
  const weeks: string[][] = [];
  for (let i = 0; i < 42; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <>
      <Topbar backHref="/admin" title="예약 픽업 달력" />
      <div className="page">
        <div className="calbar">
          <Link className="btn btn--soft btn--sm" href={`/admin/calendar?m=${prevMonth}`}>
            ‹ 이전
          </Link>
          <b className="calbar__title">{monthLabel(month)}</b>
          <Link className="btn btn--soft btn--sm" href={`/admin/calendar?m=${nextMonth}`}>
            다음 ›
          </Link>
        </div>

        <div className="cal">
          <div className="cal__dow">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={`cal__dowc ${i === 0 ? "is-sun" : ""} ${i === 6 ? "is-sat" : ""}`}
              >
                {w}
              </span>
            ))}
          </div>
          {weeks.map((week, wi) => (
            <div className="cal__week" key={wi}>
              {week.map((d) => {
                const inMonth = d.slice(0, 7) === month;
                const isToday = d === today;
                const names = byDate.get(d) ?? [];
                const day = Number(d.slice(8, 10));
                const dow = dowOf(d);
                return (
                  <div
                    key={d}
                    className={`cal__cell ${inMonth ? "" : "is-out"} ${isToday ? "is-today" : ""}`}
                  >
                    <span
                      className={`cal__day ${dow === 0 ? "is-sun" : ""} ${dow === 6 ? "is-sat" : ""}`}
                    >
                      {day}
                    </span>
                    {names.length > 0 && (
                      <div className="cal__items">
                        {names.map((n, i) => (
                          <span className="cal__item" key={i} title={n}>
                            {n}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
