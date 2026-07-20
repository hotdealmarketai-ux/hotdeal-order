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
  const ar = await prisma.invoice.groupBy({
    by: ["userId"],
    where: { status: "ISSUED", userId: { in: merchants.map((m) => m.id) } },
    _sum: { total: true },
  });
  const arMap: Record<string, number> = {};
  for (const a of ar) arMap[a.userId] = a._sum.total ?? 0;
  const totalAr = Object.values(arMap).reduce((n, v) => n + v, 0);

  return (
    <>
      <Topbar backHref="/admin" title="계산서 발행" />
      <div className="page">
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
              return (
                <Link href={`/admin/billing/${m.id}`} className="row" key={m.id}>
                  <div className="row__main">
                    <div className="row__title">{m.storeName}</div>
                    <div className="row__sub">
                      {bal > 0 ? `미수 ${won(bal)}원` : "미수 없음"}
                    </div>
                  </div>
                  <span className={`badge ${bal > 0 ? "badge--wait" : "badge--ok"}`}>
                    {bal > 0 ? "미수" : "정산"}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
