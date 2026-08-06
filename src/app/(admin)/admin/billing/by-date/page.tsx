import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { normalizeDateStr } from "@/lib/date";
import { BillingDateBar } from "@/components/BillingDateBar";
import { CATEGORIES, CATEGORY_ORDER } from "@/lib/constants";
import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";

const fmt = (n: number) => n.toLocaleString("ko-KR");
// 수량 표시 — 부동소수 정리(소수 둘째자리까지).
const fmtQty = (n: number) => String(Math.round(n * 100) / 100);

// 집계 대상 카테고리 = 일반 4종(FRUIT/VEG/TOOL/TOFU) + 주간 4종(SNACK/DAIRY/DRIED/EGG). 용달·환불은 제외.
const AGG_CATS: string[] = [...CATEGORY_ORDER, ...WEEKLY_CATEGORIES.map((c) => c.key)];
const WEEKLY_LABEL = new Map<string, string>(WEEKLY_CATEGORIES.map((c) => [c.key, c.label]));
const catLabelOf = (c: string): string =>
  (CATEGORIES as Record<string, { label: string }>)[c]?.label ?? WEEKLY_LABEL.get(c) ?? c;

// 날짜별 계산서 보기(#7·N4) — 선택한 출고일에 계산서가 있는 '지점 목록'.
// 지점 버튼을 누르면 그 지점의 계산서 상세로 이동. 기본 오늘, 상단 날짜선택.
export default async function BillingByDatePage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);

  const invoices = await prisma.invoice.findMany({
    where: { date, status: { not: "VOID" } },
    select: {
      status: true,
      total: true,
      userId: true,
      user: { select: { storeName: true } },
      // 집계용 — 전 지점 계산서의 출고 품목(카테고리·이름·수량·단위)
      items: { select: { category: true, name: true, qty: true, unit: true } },
    },
    orderBy: [{ user: { storeName: "asc" } }],
  });

  type Store = {
    userId: string;
    storeName: string;
    count: number;
    total: number;
    issued: number;
    hasDraft: boolean;
  };
  const map = new Map<string, Store>();
  for (const inv of invoices) {
    let s = map.get(inv.userId);
    if (!s) {
      s = {
        userId: inv.userId,
        storeName: inv.user.storeName,
        count: 0,
        total: 0,
        issued: 0,
        hasDraft: false,
      };
      map.set(inv.userId, s);
    }
    s.count += 1;
    if (inv.status === "DRAFT") s.hasDraft = true;
    else {
      s.total += inv.total;
      s.issued += 1;
    }
  }
  const stores = [...map.values()];
  const issuedTotal = stores.reduce((n, s) => n + s.total, 0);
  const issuedCount = stores.reduce((n, s) => n + s.issued, 0);

  // 총 집계 — 전 지점 계산서의 출고 품목을 카테고리별·품목명별로 수량 합산.
  // status VOID 제외분(작성중 포함) 전체 대상. 일반 4종 + 주간 4종을 함께 집계(주간 품목도 그 출고일에 포함).
  const aggMap = new Map<string, { category: string; name: string; unit: string; qty: number }>();
  for (const inv of invoices) {
    for (const it of inv.items) {
      const cat = it.category;
      if (!AGG_CATS.includes(cat)) continue; // 일반 4종 + 주간 4종만(용달·환불 제외)
      const name = it.name.trim();
      if (!name) continue;
      const key = `${cat}::${name}::${it.unit}`;
      const cur = aggMap.get(key);
      if (cur) cur.qty += it.qty;
      else aggMap.set(key, { category: cat, name, unit: it.unit, qty: it.qty });
    }
  }
  const aggByCat = AGG_CATS.map((c) => ({
    key: c,
    label: catLabelOf(c),
    items: [...aggMap.values()]
      .filter((a) => a.category === c)
      .sort((a, b) => a.name.localeCompare(b.name, "ko")),
  })).filter((g) => g.items.length > 0);
  const aggItemCount = aggByCat.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <Topbar backHref="/admin/billing" title="날짜별 계산서" />
      <div className="page">
        <BillingDateBar date={date} />

        <div className="card" style={{ margin: "12px 0 16px" }}>
          <div className="row__sub">발행 {issuedCount}건 합계</div>
          <div
            style={{
              fontSize: 22,
              fontWeight: 800,
              marginTop: 2,
              color: "var(--green-700)",
            }}
          >
            {fmt(issuedTotal)}원
          </div>
        </div>

        {/* 총 집계 — 전 지점 계산서 출고 품목 합산(기본 닫힘) */}
        {aggItemCount > 0 && (
          <details className="wagg" style={{ marginBottom: 16 }}>
            <summary className="wagg__sum">집계 ({aggItemCount}개 품목)</summary>
            <div style={{ marginTop: 10 }}>
              {aggByCat.map((g) => (
                <div className="invcat" key={g.key}>
                  <div className="invcat__head">
                    <span className="chip">{g.label}</span>
                    <span className="invcat__sum">{g.items.length}개 품목</span>
                  </div>
                  {g.items.map((a, i) => (
                    <div className="confitem" key={i}>
                      <span className="confitem__name">{a.name}</span>
                      <span className="confitem__qtytext">
                        {fmtQty(a.qty)}
                        {a.unit || "개"}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        )}

        {stores.length === 0 ? (
          <div className="empty">
            <p>이 출고일에 발행/작성된 계산서가 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {stores.map((s) => (
              <Link
                key={s.userId}
                href={`/admin/billing/by-date/${s.userId}?date=${date}`}
                className={`row${s.hasDraft ? " row--draft" : ""}`}
              >
                <div className="row__main">
                  <div className="row__title">{s.storeName}</div>
                  <div className="row__sub">
                    계산서 {s.count}건
                    {s.total > 0 ? ` · ${fmt(s.total)}원` : ""}
                  </div>
                </div>
                {s.hasDraft ? (
                  <span className="badge badge--onbrand">작성중</span>
                ) : (
                  <span className="row__chev">›</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
