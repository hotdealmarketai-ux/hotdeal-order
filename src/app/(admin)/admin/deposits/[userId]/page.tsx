import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKDateTime, formatKDate } from "@/lib/format";
import { labelDate } from "@/lib/date";
import { receivableOf, orderLockOf } from "@/lib/receivable";
import { setOrderUnlockAction } from "@/app/actions/deposit";
import { ManualPayButton } from "@/components/ManualPayButton";

const fmt = (n: number) => n.toLocaleString("ko-KR");

type LedgerRow =
  | {
      kind: "invoice";
      at: Date;
      date: string;
      amount: number;
      id: string;
      status: string;
      splitRequested: boolean;
    }
  | { kind: "deposit"; at: Date; amount: number; payer: string; via: string };

// 점포 입출금 내역 — 통장 거래내역처럼 날짜순으로 '입금 요청(청구)'와 '입금'을 나열.
export default async function AdminDepositStore(props: {
  params: Promise<{ userId: string }>;
}) {
  await requireAdmin();
  const { userId } = await props.params;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "MERCHANT_HOTDEAL") notFound();

  const [invoices, deposits, ar, lock] = await Promise.all([
    prisma.invoice.findMany({
      where: { userId, status: { not: "VOID" } },
      select: {
        id: true,
        date: true,
        total: true,
        status: true,
        splitRequested: true,
        issuedAt: true,
        createdAt: true,
      },
    }),
    prisma.deposit.findMany({
      where: { matchedUserId: userId, matchStatus: { in: ["AUTO", "MANUAL"] } },
      select: {
        id: true,
        txAt: true,
        amount: true,
        payerName: true,
        matchStatus: true,
      },
    }),
    receivableOf(userId),
    orderLockOf(userId, user.orderUnlock),
  ]);

  const totalBilled = invoices.reduce((n, i) => n + i.total, 0);
  const totalPaid = deposits.reduce((n, d) => n + d.amount, 0);

  const rows: LedgerRow[] = [
    ...invoices.map(
      (i): LedgerRow => ({
        kind: "invoice",
        at: i.issuedAt ?? i.createdAt,
        date: i.date,
        amount: i.total,
        id: i.id,
        status: i.status,
        splitRequested: i.splitRequested,
      }),
    ),
    ...deposits.map(
      (d): LedgerRow => ({
        kind: "deposit",
        at: d.txAt,
        amount: d.amount,
        payer: d.payerName || "(입금자명 없음)",
        via: d.matchStatus === "AUTO" ? "자동" : "수동",
      }),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return (
    <>
      <header className="topbar">
        <Link href="/admin/deposits" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">{user.storeName}</div>
      </header>
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">남은 결제잔액 (미입금액)</div>
          <div
            style={{
              fontSize: 26,
              fontWeight: 800,
              marginTop: 4,
              color: ar.balance > 0 ? "var(--danger)" : "var(--fg)",
            }}
          >
            {fmt(ar.balance)}원
          </div>
          <div className="row__sub" style={{ marginTop: 2 }}>
            입금자 {user.payerNames[0] ?? "미등록"} · 총 청구 {fmt(totalBilled)}원
            · 총 입금 {fmt(totalPaid)}원
          </div>
          <div style={{ marginTop: 12 }}>
            {lock.locked ? (
              <span className="badge badge--danger">발주 잠김</span>
            ) : user.orderUnlock ? (
              <span className="badge badge--wait">발주 잠금 해제됨</span>
            ) : (
              <span className="badge badge--ok">발주 정상</span>
            )}
            <form
              action={setOrderUnlockAction}
              style={{ display: "inline-block", marginLeft: 10 }}
            >
              <input type="hidden" name="userId" value={userId} />
              <input
                type="hidden"
                name="unlock"
                value={user.orderUnlock ? "false" : "true"}
              />
              <button type="submit" className="btn btn--xs btn--soft">
                {user.orderUnlock ? "발주 다시 잠금" : "발주 잠금 해제"}
              </button>
            </form>
          </div>
        </div>

        <div className="section-label">입출금 내역</div>
        {rows.length === 0 ? (
          <div className="empty">
            <p>아직 청구·입금 내역이 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {rows.map((r, i) =>
              r.kind === "invoice" ? (
                <div className="row" key={`inv-${r.id}`}>
                  <div className="row__main">
                    <Link
                      href={`/admin/invoices/${r.id}`}
                      className="row__title"
                      style={{ textDecoration: "none" }}
                    >
                      입금 요청 · {labelDate(r.date)}
                      {r.splitRequested && (
                        <span
                          className="badge badge--wait"
                          style={{ marginLeft: 8 }}
                        >
                          분할요청
                        </span>
                      )}
                    </Link>
                    <div className="row__sub">
                      {r.status === "PAID" ? "입금 완료" : "입금 대기"}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div className="ledger__req">+{fmt(r.amount)}원</div>
                    {r.status === "ISSUED" && (
                      <div style={{ marginTop: 6 }}>
                        <ManualPayButton invoiceId={r.id} />
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="row" key={`dep-${i}`}>
                  <div className="row__main">
                    <div className="row__title">입금 · {r.payer}</div>
                    <div className="row__sub">
                      {formatKDate(r.at)} · {r.via} 매칭
                    </div>
                  </div>
                  <div className="ledger__pay">−{fmt(r.amount)}원</div>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </>
  );
}
