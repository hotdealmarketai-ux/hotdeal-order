import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, labelDate, dowOf } from "@/lib/date";

export const dynamic = "force-dynamic";

// 예약 픽업 일정 — 달력 그리드 대신, 예약발주(수기 예약상품)가 잡힌 '픽업일자'만 리스트로.
// 오늘 이후 예정된 픽업일만, 날짜별로 그 날 픽업할 품목을 함께 보여준다.
export default async function AdminCalendarPage() {
  await requireAdmin();
  const today = kstToday();

  // 수기 예약상품만(inventoryItemId 빈값 = 재고 연동 아님) · 활성 배치 · 오늘 이후 픽업.
  const products = await prisma.reservationProduct.findMany({
    where: {
      active: true,
      inventoryItemId: "",
      batch: { active: true },
      pickupDate: { gte: today },
    },
    orderBy: [{ pickupDate: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    select: { name: true, pickupDate: true },
  });

  // 픽업일자별로 묶기(예약이 잡힌 날짜만 남는다).
  const byDate = new Map<string, string[]>();
  for (const p of products) {
    if (!p.pickupDate) continue;
    const list = byDate.get(p.pickupDate) ?? [];
    list.push(p.name);
    byDate.set(p.pickupDate, list);
  }
  const days = [...byDate.entries()]
    .map(([date, names]) => ({ date, names }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  return (
    <>
      <Topbar backHref="/admin" title="예약 픽업 일정" />
      <div className="page">
        {days.length === 0 ? (
          <div className="empty">
            <p>예정된 예약 픽업이 없어요.</p>
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {days.map((d) => {
              const dow = dowOf(d.date);
              return (
                <div className="card" key={d.date} style={{ padding: 14 }}>
                  <div className="spread" style={{ alignItems: "center", marginBottom: 10 }}>
                    <b
                      style={{
                        fontSize: 16,
                        color:
                          dow === 0
                            ? "var(--danger)"
                            : dow === 6
                              ? "var(--blue, #2563eb)"
                              : "var(--fg)",
                      }}
                    >
                      {labelDate(d.date)}
                      {d.date === today && (
                        <span
                          className="badge badge--onbrand"
                          style={{ marginLeft: 8, verticalAlign: "middle" }}
                        >
                          오늘
                        </span>
                      )}
                    </b>
                    <span className="row__sub" style={{ flexShrink: 0 }}>
                      {d.names.length}개 품목
                    </span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {d.names.map((n, i) => (
                      <span className="chip" key={i}>
                        {n}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
