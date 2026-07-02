import Link from "next/link";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { labelDate } from "@/lib/date";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 점주 계산서함 — 새롭이 발행한 입금요청서 목록 + 미수 잔액
export default async function MerchantInvoices() {
  const user = await requireMerchant();

  const [invoices, ar] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId: user.id, status: { in: ["ISSUED", "PAID"] } },
      orderBy: { issuedAt: "desc" },
      take: 100,
    }),
    // 잔액은 목록 슬라이스가 아니라 전체 집계로(100건 넘어도 정확)
    prisma.invoice.aggregate({
      where: { userId: user.id, status: "ISSUED" },
      _sum: { total: true },
    }),
  ]);
  const balance = ar._sum.total ?? 0;

  return (
    <>
      <header className="topbar">
        <Link href="/mypage" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">계산서함</div>
      </header>
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">미수 잔액 (입금 대기 합계)</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>
            {balance > 0 ? `${fmt(balance)}원` : "0원"}
          </div>
          {balance > 0 && (
            <div className="row__sub" style={{ marginTop: 2 }}>
              입금이 확인되면 자동으로 줄어들어요.
            </div>
          )}
        </div>

        {invoices.length === 0 ? (
          <div className="empty">
            <p>아직 받은 계산서가 없어요.</p>
            <p className="hint">출고 후 새롭에서 입금요청서를 보내면 여기에 떠요.</p>
          </div>
        ) : (
          <div className="list">
            {invoices.map((inv) => (
              <Link href={`/invoices/${inv.id}`} className="row" key={inv.id}>
                <div className="row__main">
                  <div className="row__title">
                    {labelDate(inv.date)} 입금요청서
                  </div>
                  <div className="row__sub">{fmt(inv.total)}원 · 새롭</div>
                </div>
                {inv.status === "PAID" ? (
                  <span className="badge badge--ok">입금 완료</span>
                ) : (
                  <span className="badge badge--wait">입금 대기</span>
                )}
              </Link>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
