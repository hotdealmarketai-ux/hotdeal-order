import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { labelDate, shiftDate } from "@/lib/date";
import {
  salesInRange,
  salesByMonth,
  salesStores,
  dayRangeUtc,
  weekRangeUtc,
  monthRangeUtc,
  normalizeDay,
  normalizeMonth,
  kstThisMonth,
  SALES_CATS,
  salesCatLabel,
  type SalesAgg,
} from "@/lib/sales";
import { SalesStoreSelect } from "@/components/SalesStoreSelect";

const won = (n: number) => n.toLocaleString("ko-KR");
export const maxDuration = 60;

type Period = "day" | "week" | "month";

// 가로 막대 한 줄(클릭 시 필터 이동 가능)
function Bar({
  label,
  amount,
  qty,
  max,
  href,
  active,
}: {
  label: string;
  amount: number;
  qty?: number;
  max: number;
  href?: string;
  active?: boolean;
}) {
  const pct = Math.max(2, Math.min(100, Math.round((Math.abs(amount) / max) * 100)));
  const neg = amount < 0;
  const inner = (
    <div
      style={{
        position: "relative",
        padding: "9px 12px",
        borderRadius: 10,
        overflow: "hidden",
        background: active ? "var(--green-100)" : "var(--surface-2, #f5f5f4)",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          width: `${pct}%`,
          background: neg ? "rgba(220,60,60,.14)" : "var(--green-100, #e6f0ea)",
          borderRight: `2px solid ${neg ? "var(--danger)" : "var(--green-700)"}`,
        }}
      />
      <div
        style={{
          position: "relative",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 700 }}>
          {label}
          {qty != null && qty !== 0 && (
            <span style={{ color: "var(--muted)", fontWeight: 400, marginLeft: 6, fontSize: 12 }}>
              {Number.isInteger(qty) ? qty : qty.toFixed(1)}
            </span>
          )}
        </span>
        <span
          style={{
            fontWeight: 800,
            fontVariantNumeric: "tabular-nums",
            color: neg ? "var(--danger)" : "var(--fg)",
          }}
        >
          {won(amount)}
        </span>
      </div>
    </div>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: "none", color: "inherit", display: "block" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default async function AdminSalesPage(props: {
  searchParams: Promise<{
    period?: string;
    d?: string;
    cat?: string;
    store?: string;
    view?: string;
  }>;
}) {
  await requireAdmin();
  const sp = await props.searchParams;
  const stores = await salesStores();

  // ── 월별 목록 (년 > 각 달) ──
  if (sp.view === "months") {
    const months = await salesByMonth();
    const byYear = new Map<string, { month: string; total: number }[]>();
    for (const m of months) {
      const y = m.month.slice(0, 4);
      const arr = byYear.get(y);
      if (arr) arr.push(m);
      else byYear.set(y, [m]);
    }
    return (
      <>
        <Topbar backHref="/admin/sales" title="월별 매출" />
        <div className="page">
          {months.length === 0 ? (
            <div className="empty">
              <p>매출이 없어요.</p>
            </div>
          ) : (
            [...byYear.entries()].map(([year, ms]) => (
              <div key={year} style={{ marginBottom: 18 }}>
                <div className="section-label">{year}년</div>
                <div className="list">
                  {ms.map((m) => (
                    <Link
                      href={`/admin/sales?period=month&d=${m.month}`}
                      className="row"
                      key={m.month}
                    >
                      <div className="row__main">
                        <div className="row__title">{Number(m.month.slice(5, 7))}월</div>
                      </div>
                      <div style={{ fontWeight: 800, fontVariantNumeric: "tabular-nums" }}>
                        {won(m.total)}원
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </>
    );
  }

  // ── 기간 뷰(일/주/월) ──
  const period: Period = (["day", "week", "month"] as const).includes(sp.period as Period)
    ? (sp.period as Period)
    : "day";
  const cat = sp.cat && SALES_CATS.some((c) => c.key === sp.cat) ? sp.cat : undefined;
  const storeId = sp.store || undefined;

  let range: { start: Date; end: Date };
  let prevRange: { start: Date; end: Date };
  let label: string;
  let curD: string;
  let prevD: string;
  let nextD: string;
  let prevLabel: string;

  if (period === "month") {
    curD = normalizeMonth(sp.d);
    range = monthRangeUtc(curD);
    const [y, m] = curD.split("-").map(Number);
    prevD = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
    nextD = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
    prevRange = monthRangeUtc(prevD);
    label = `${y}년 ${m}월`;
    prevLabel = "전월";
  } else if (period === "week") {
    curD = normalizeDay(sp.d);
    const w = weekRangeUtc(curD);
    range = { start: w.start, end: w.end };
    prevD = shiftDate(curD, -7);
    nextD = shiftDate(curD, 7);
    const pw = weekRangeUtc(prevD);
    prevRange = { start: pw.start, end: pw.end };
    label = `${labelDate(w.startDate)} ~ ${labelDate(w.endDate)}`;
    prevLabel = "전주";
  } else {
    curD = normalizeDay(sp.d);
    range = dayRangeUtc(curD);
    prevD = shiftDate(curD, -1);
    nextD = shiftDate(curD, 1);
    prevRange = dayRangeUtc(prevD);
    label = labelDate(curD);
    prevLabel = "전일";
  }

  // 이번 달 누적(월-투-데이트) — 어떤 기간을 보고 있어도 상시 노출. 같은 지점·카테고리 필터를 그대로 적용.
  // 지금 보는 화면이 '이번 달 월 뷰'면 위 총 매출이 곧 이번 달 누적이라 중복이므로 별도 조회/표시 안 함.
  const thisMonth = kstThisMonth();
  const onThisMonth = period === "month" && curD === thisMonth;
  const mRange = monthRangeUtc(thisMonth);
  const [agg, prev, mtd] = await Promise.all([
    salesInRange(range.start, range.end, { category: cat, storeId }),
    salesInRange(prevRange.start, prevRange.end, { category: cat, storeId }),
    onThisMonth
      ? Promise.resolve(null)
      : salesInRange(mRange.start, mRange.end, { category: cat, storeId }),
  ]);

  const delta =
    prev.total === 0
      ? null
      : Math.round(((agg.total - prev.total) / Math.abs(prev.total)) * 100);

  const url = (over: Record<string, string | undefined>) => {
    const base: Record<string, string | undefined> = {
      period,
      d: curD,
      cat,
      store: storeId,
      ...over,
    };
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const q = p.toString();
    return `/admin/sales${q ? `?${q}` : ""}`;
  };

  const maxCat = Math.max(1, ...agg.byCategory.map((c) => Math.abs(c.amount)));
  const maxStore = Math.max(1, ...agg.byStore.map((s) => Math.abs(s.amount)));

  // 품목을 카테고리별로 묶기
  const itemsByCat = new Map<string, SalesAgg["items"]>();
  for (const it of agg.items) {
    const arr = itemsByCat.get(it.category);
    if (arr) arr.push(it);
    else itemsByCat.set(it.category, [it]);
  }

  const tab = (p: Period, t: string) => (
    <Link
      href={url({ period: p, d: p === "month" ? curD.slice(0, 7) : curD.length === 7 ? `${curD}-01` : curD })}
      className={`cattab ${period === p ? "is-active" : ""}`}
      style={{ textAlign: "center" }}
    >
      {t}
    </Link>
  );

  return (
    <>
      <Topbar backHref="/admin" title="매출" />
      <div className="page">
        {/* 기간 탭 + 월별 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <div className="cattabs cattabs--seg" style={{ flex: 1 }}>
            {tab("day", "일")}
            {tab("week", "주")}
            {tab("month", "월")}
          </div>
          <Link
            href="/admin/sales?view=months"
            className="btn btn--soft"
            style={{ flexShrink: 0, width: "auto", whiteSpace: "nowrap" }}
          >
            월별
          </Link>
        </div>

        {/* 기간 이동 */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 12,
          }}
        >
          <Link href={url({ d: prevD })} className="btn btn--xs btn--ghost" aria-label="이전">
            ◀
          </Link>
          <div style={{ fontWeight: 800 }}>{label}</div>
          <Link href={url({ d: nextD })} className="btn btn--xs btn--ghost" aria-label="다음">
            ▶
          </Link>
        </div>

        {/* 총 매출 */}
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="row__sub">총 매출{cat ? ` · ${salesCatLabel(cat)}` : ""}</div>
          <div
            style={{
              fontSize: 30,
              fontWeight: 800,
              marginTop: 2,
              fontVariantNumeric: "tabular-nums",
              color: agg.total < 0 ? "var(--danger)" : "var(--green-700)",
            }}
          >
            {won(agg.total)}원
          </div>
          <div className="row__sub" style={{ marginTop: 4, display: "flex", gap: 10 }}>
            <span>계산서 {agg.invoiceCount}건</span>
            {delta != null && (
              <span style={{ color: delta >= 0 ? "var(--green-700)" : "var(--danger)" }}>
                {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% {prevLabel} ({won(prev.total)})
              </span>
            )}
          </div>
        </div>

        {/* 이번 달 누적 — 상시 노출(현재 화면이 이번 달 월 뷰일 땐 위 총 매출과 중복이라 생략) */}
        {!onThisMonth && mtd && (
          <Link
            href={`/admin/sales?period=month&d=${thisMonth}${cat ? `&cat=${cat}` : ""}${
              storeId ? `&store=${storeId}` : ""
            }`}
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 14,
              textDecoration: "none",
              background: "var(--green-50)",
              borderColor: "var(--green-150)",
            }}
          >
            <span style={{ fontWeight: 700, color: "var(--green-800)" }}>
              이번 달 누적{cat ? ` · ${salesCatLabel(cat)}` : ""}
            </span>
            <span
              style={{
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                color: mtd.total < 0 ? "var(--danger)" : "var(--green-700)",
              }}
            >
              {won(mtd.total)}원 ›
            </span>
          </Link>
        )}

        {/* 필터: 지점 + 카테고리 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <SalesStoreSelect stores={stores} value={storeId ?? ""} />
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
          <Link
            href={url({ cat: undefined })}
            className={`chip ${!cat ? "chip--on" : ""}`}
            style={chipStyle(!cat)}
          >
            전체
          </Link>
          {SALES_CATS.map((c) => (
            <Link
              key={c.key}
              href={url({ cat: c.key })}
              className="chip"
              style={chipStyle(cat === c.key)}
            >
              {c.label}
            </Link>
          ))}
        </div>

        {agg.invoiceCount === 0 ? (
          <div className="empty">
            <p>이 기간 매출이 없어요.</p>
          </div>
        ) : (
          <>
            {/* 카테고리별 */}
            {!cat && agg.byCategory.length > 0 && (
              <>
                <div className="section-label">카테고리</div>
                <div className="stack" style={{ gap: 6, marginBottom: 18 }}>
                  {agg.byCategory.map((c) => (
                    <Bar
                      key={c.key}
                      label={c.label}
                      amount={c.amount}
                      qty={c.qty}
                      max={maxCat}
                      href={url({ cat: c.key })}
                    />
                  ))}
                </div>
              </>
            )}

            {/* 지점별 */}
            {!storeId && agg.byStore.length > 0 && (
              <>
                <div className="section-label">지점</div>
                <div className="stack" style={{ gap: 6, marginBottom: 18 }}>
                  {agg.byStore.map((s) => (
                    <Bar
                      key={s.userId}
                      label={s.store}
                      amount={s.amount}
                      max={maxStore}
                      href={url({ store: s.userId })}
                    />
                  ))}
                </div>
              </>
            )}

            {/* 품목 (카테고리별로 묶어서) — 일단위 뷰 전용(요구사항). 주/월은 항목이 수백 줄이 되므로 대신 아래 '인기 품목'으로 요약. */}
            {period === "day" && (
            <>
            <div className="section-label">품목</div>
            <div style={{ marginBottom: 18 }}>
              {[...itemsByCat.entries()].map(([c, list]) => (
                <div key={c} style={{ marginBottom: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      fontWeight: 800,
                      margin: "0 2px 6px",
                    }}
                  >
                    <span>{salesCatLabel(c)}</span>
                    <span style={{ fontVariantNumeric: "tabular-nums" }}>
                      {won(list.reduce((n, i) => n + i.amount, 0))}
                    </span>
                  </div>
                  <div className="list">
                    {list.map((i) => (
                      <div className="row" key={`${c} ${i.name}`}>
                        <div className="row__main">
                          <div className="row__title">{i.name}</div>
                          <div className="row__sub">
                            {Number.isInteger(i.qty) ? i.qty : i.qty.toFixed(1)}
                          </div>
                        </div>
                        <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                          {won(i.amount)}원
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            </>
            )}

            {/* 인기 품목(분석) */}
            {agg.topProducts.length > 0 && (
              <>
                <div className="section-label">인기 품목</div>
                <div className="list" style={{ marginBottom: 18 }}>
                  {agg.topProducts.map((t, i) => (
                    <div className="row" key={`${t.category} ${t.name}`}>
                      <div className="row__main">
                        <div className="row__title">
                          <span
                            style={{
                              display: "inline-block",
                              minWidth: 20,
                              color: "var(--muted)",
                              fontWeight: 800,
                            }}
                          >
                            {i + 1}
                          </span>
                          {t.name}
                        </div>
                        <div className="row__sub">
                          {salesCatLabel(t.category)} ·{" "}
                          {Number.isInteger(t.qty) ? t.qty : t.qty.toFixed(1)}
                        </div>
                      </div>
                      <div style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {won(t.amount)}원
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function chipStyle(on: boolean): React.CSSProperties {
  return {
    padding: "5px 12px",
    borderRadius: 999,
    fontSize: 13,
    fontWeight: 700,
    textDecoration: "none",
    border: "1px solid var(--border, #e5e5e5)",
    background: on ? "var(--green-700)" : "transparent",
    color: on ? "#fff" : "var(--fg)",
  };
}
