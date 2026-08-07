import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER } from "@/lib/constants";
import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";
import { normalizeDateStr, labelDate } from "@/lib/date";
import { sumQty } from "@/lib/qty";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 표시 순서·라벨: 일반 4종(FRUIT/VEG/TOOL/TOFU) + 주간발주(계산서에 불러온 주간분=단일 "WEEKLY")
// + 주간 카탈로그 4종(SNACK/DAIRY/DRIED/EGG, 별도 주간 계산서용).
const ALL_CATS: string[] = [...CATEGORY_ORDER, "WEEKLY", ...WEEKLY_CATEGORIES.map((c) => c.key)];
const WEEKLY_LABEL = new Map<string, string>([
  ["WEEKLY", "주간발주"],
  ...WEEKLY_CATEGORIES.map((c): [string, string] => [c.key, c.label]),
]);
const catLabelOf = (c: string): string =>
  (CATEGORIES as Record<string, { label: string }>)[c]?.label ?? WEEKLY_LABEL.get(c) ?? c;

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "작성중", cls: "badge--onbrand" },
  ISSUED: { label: "입금 대기", cls: "badge--wait" },
  PAID: { label: "입금 완료", cls: "badge--ok" },
};
const KIND: Record<string, string> = {
  DAILY: "일반",
  WEEKLY: "주간",
  RESERVATION: "예약",
};

// 날짜별 계산서 — 특정 지점의 그 출고일 계산서 상세(카드). 지점 목록에서 진입.
export default async function BillingByDateStorePage(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { userId } = await props.params;
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam);

  const [merchant, invoices] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { storeName: true },
    }),
    prisma.invoice.findMany({
      where: { userId, date, status: { not: "VOID" } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
      orderBy: { kind: "asc" },
    }),
  ]);
  if (!merchant) notFound();

  return (
    <>
      <Topbar
        backHref={`/admin/billing/by-date?date=${date}`}
        title={merchant.storeName}
      />
      <div className="page">
        <p className="lead" style={{ marginBottom: 14 }}>
          출고 {labelDate(date)} 계산서
        </p>

        {invoices.length === 0 ? (
          <div className="empty">
            <p>이 출고일에 계산서가 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {invoices.map((inv) => {
              const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT;
              // 일반 4종 + 주간 4종 중 이 계산서에 실제로 있는 카테고리만(주간 계산서면 과자류·유제품 등이 잡힌다).
              const cats = ALL_CATS.filter((c) =>
                inv.items.some((it) => it.category === c),
              );
              return (
                <Link
                  href={`/admin/invoices/${inv.id}`}
                  className="card invcard"
                  key={inv.id}
                >
                  <div className="spread" style={{ marginBottom: 8 }}>
                    <div className="receipt__meta">
                      {KIND[inv.kind] ?? inv.kind} 계산서
                    </div>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  </div>

                  {cats.map((c) => {
                    const items = inv.items.filter((it) => it.category === c);
                    const sum = items.reduce((n, it) => n + it.amount, 0);
                    return (
                      <div className="invcat" key={c}>
                        <div className="invcat__head">
                          <span className="chip">{catLabelOf(c)}</span>
                          <span className="invcat__sum">
                            총 {fmt(sumQty(items.map((it) => String(it.qty))))}개 ·{" "}
                            {fmt(sum)}원
                          </span>
                        </div>
                        {items.map((it, i) => (
                          <div className="invline" key={it.id}>
                            <span>
                              <span className="receipt-item__no">{i + 1}</span>
                              {it.name}
                              <span className="invline__meta">
                                {String(it.qty)} × {fmt(it.unitPrice)}
                              </span>
                            </span>
                            <span className="invline__amt">{fmt(it.amount)}원</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}

                  {inv.items
                    .filter((it) => it.category === "DELIVERY")
                    .map((it) => (
                      <div className="invcat" key={it.id}>
                        <div className="invcat__head">
                          <span className="chip">용달 발송</span>
                          <span className="invcat__sum">{fmt(it.amount)}원</span>
                        </div>
                        <div className="invline">
                          <span>용차비용</span>
                          <span className="invline__amt">{fmt(it.amount)}원</span>
                        </div>
                      </div>
                    ))}

                  <div className="invgrand">
                    <span>총 결제요청 금액</span>
                    <b>{fmt(inv.total)}원</b>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
