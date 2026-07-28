import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { normalizeDateStr, labelDate } from "@/lib/date";
import { sumQty } from "@/lib/qty";
import { BillingDateBar } from "@/components/BillingDateBar";

const fmt = (n: number) => n.toLocaleString("ko-KR");

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "작성중", cls: "badge--mute" },
  ISSUED: { label: "입금 대기", cls: "badge--wait" },
  PAID: { label: "입금 완료", cls: "badge--ok" },
};
const KIND: Record<string, string> = {
  DAILY: "일반",
  WEEKLY: "주간",
  RESERVATION: "예약",
};

// 날짜별 계산서 보기(#7) — 선택한 출고일의 전 가맹점 계산서를 한 화면에.
// 기본 오늘. 상단 날짜선택으로 다른 출고일 조회. 취소(VOID) 제외, 작성중/발행/입금완료 표시.
export default async function BillingByDatePage(props: {
  searchParams: Promise<{ date?: string }>;
}) {
  await requireAdmin();
  const { date: dateParam } = await props.searchParams;
  const date = normalizeDateStr(dateParam); // 미지정 시 오늘

  const invoices = await prisma.invoice.findMany({
    where: { date, status: { not: "VOID" } },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
      user: { select: { storeName: true } },
    },
    orderBy: [{ user: { storeName: "asc" } }, { kind: "asc" }],
  });

  const issuedTotal = invoices
    .filter((inv) => inv.status !== "DRAFT")
    .reduce((n, inv) => n + inv.total, 0);
  const issuedCount = invoices.filter((inv) => inv.status !== "DRAFT").length;
  const draftCount = invoices.filter((inv) => inv.status === "DRAFT").length;

  return (
    <>
      <Topbar backHref="/admin/billing" title="날짜별 계산서" />
      <div className="page">
        <BillingDateBar date={date} />

        <div className="card" style={{ margin: "12px 0 16px" }}>
          <div className="spread">
            <div>
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
            {draftCount > 0 && (
              <span className="badge badge--mute">작성중 {draftCount}건</span>
            )}
          </div>
        </div>

        {invoices.length === 0 ? (
          <div className="empty">
            <p>이 출고일에 발행/작성된 계산서가 없어요.</p>
          </div>
        ) : (
          <div className="stack">
            {invoices.map((inv) => {
              const badge = STATUS_BADGE[inv.status] ?? STATUS_BADGE.DRAFT;
              const cats = CATEGORY_ORDER.filter((c) =>
                inv.items.some((it) => it.category === c),
              );
              return (
                <Link
                  href={`/admin/invoices/${inv.id}`}
                  className="card invcard"
                  key={inv.id}
                >
                  <div className="spread" style={{ marginBottom: 8 }}>
                    <div className="receipt__store" style={{ fontSize: 18 }}>
                      {inv.user.storeName}
                    </div>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="receipt__meta" style={{ marginBottom: 10 }}>
                    {KIND[inv.kind] ?? inv.kind} 계산서
                  </div>

                  {cats.map((c) => {
                    const items = inv.items.filter((it) => it.category === c);
                    const sum = items.reduce((n, it) => n + it.amount, 0);
                    return (
                      <div className="invcat" key={c}>
                        <div className="invcat__head">
                          <span className="chip">{CATEGORIES[c].label}</span>
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
