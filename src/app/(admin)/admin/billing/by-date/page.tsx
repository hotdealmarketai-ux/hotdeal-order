import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { normalizeDateStr } from "@/lib/date";
import { BillingDateBar } from "@/components/BillingDateBar";

const fmt = (n: number) => n.toLocaleString("ko-KR");

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
