import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKDateTime } from "@/lib/format";

export default async function AdminDeposits() {
  await requireAdmin();

  const deposits = await prisma.deposit.findMany({
    orderBy: { txAt: "desc" },
    take: 200,
    include: { matchedUser: true },
  });
  const unmatched = deposits.filter((d) => d.matchStatus === "UNMATCHED").length;

  return (
    <>
      <header className="topbar">
        <Link href="/admin" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">입금 내역</div>
      </header>
      <div className="page">
        <p className="lead" style={{ marginTop: 0 }}>
          하나 법인계좌 입금 {deposits.length}건
          {unmatched > 0 ? ` · 미매칭 ${unmatched}건` : ""}
        </p>

        {deposits.length === 0 ? (
          <div className="empty">
            <p>아직 수집된 입금 내역이 없어요.</p>
            <p className="hint">
              팝빌 계좌조회 연동(2단계) 후 입금이 자동으로 여기 쌓여요.
            </p>
          </div>
        ) : (
          <div className="list">
            {deposits.map((d) => (
              <div className="row" key={d.id}>
                <div className="row__main">
                  <div className="row__title">
                    {d.payerName || "(입금자명 없음)"} ·{" "}
                    {d.amount.toLocaleString("ko-KR")}원
                  </div>
                  <div className="row__sub">
                    {formatKDateTime(d.txAt)}
                    {d.memo ? ` · ${d.memo}` : ""}
                  </div>
                </div>
                {d.matchStatus === "UNMATCHED" ? (
                  <span className="badge badge--wait">미매칭</span>
                ) : (
                  <span className="badge badge--ok">
                    {d.matchedUser?.storeName ?? "확인됨"}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
