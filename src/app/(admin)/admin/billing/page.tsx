import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

const won = (n: number) => n.toLocaleString("ko-KR");

// 계산서 발행 — 핫딜마켓 가맹점 목록. 점포를 눌러 발행/미수/발행목록 확인.
export default async function AdminBillingPage() {
  await requireAdmin();

  const merchants = await prisma.user.findMany({
    where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
    orderBy: { storeName: "asc" },
    select: { id: true, storeName: true },
  });
  const ids = merchants.map((m) => m.id);
  const [ar, adj, drafts] = await Promise.all([
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { status: "ISSUED", userId: { in: ids } },
      _sum: { total: true },
    }),
    // 미수 = 발행·미입금 계산서 합 + 관리자 수동조정(ReceivableAdjustment) — receivableOf·입금관리와 동일 기준.
    // 수동조정을 빠뜨리면 입금관리에서 맞춘 미수와 이 목록 숫자가 안 맞는다.
    prisma.receivableAdjustment.groupBy({
      by: ["userId"],
      where: { userId: { in: ids } },
      _sum: { amount: true },
    }),
    // 작성중(DRAFT) 계산서가 있는 지점 — 목록에서 브랜드컬러로 강조
    prisma.invoice.findMany({
      where: { status: "DRAFT", userId: { in: ids } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);
  const arMap: Record<string, number> = {};
  for (const a of ar) arMap[a.userId] = a._sum.total ?? 0;
  for (const a of adj) arMap[a.userId] = (arMap[a.userId] ?? 0) + (a._sum.amount ?? 0);
  const totalAr = Object.values(arMap).reduce((n, v) => n + v, 0);
  const draftUserIds = new Set(drafts.map((d) => d.userId));

  return (
    <>
      <Topbar backHref="/admin" title="계산서 발행" />
      <div className="page">
        <Link
          href="/admin/billing/by-date"
          className="btn btn--soft"
          style={{ marginBottom: 12 }}
        >
          날짜별 계산서 보기
        </Link>

        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">전체 미수 (발행 후 미입금)</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: "var(--green-700)" }}>
            {won(totalAr)}원
          </div>
        </div>

        <div className="itemshead">
          <span className="itemshead__label">가맹점</span>
          <span className="itemshead__count">{merchants.length}곳</span>
        </div>
        {merchants.length === 0 ? (
          <div className="empty">가맹점이 없어요.</div>
        ) : (
          <div className="list">
            {merchants.map((m) => {
              const bal = arMap[m.id] ?? 0;
              const draft = draftUserIds.has(m.id);
              return (
                <Link
                  href={`/admin/billing/${m.id}`}
                  className={`row${draft ? " row--draft" : ""}`}
                  key={m.id}
                >
                  <div className="row__main">
                    <div className="row__title">{m.storeName}</div>
                    <div className="row__sub">
                      {bal > 0 ? `미수 ${won(bal)}원` : "미수 없음"}
                    </div>
                  </div>
                  {draft ? (
                    <span className="badge badge--onbrand">작성중</span>
                  ) : (
                    <span className={`badge ${bal > 0 ? "badge--wait" : "badge--ok"}`}>
                      {bal > 0 ? "미수" : "정산"}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
