import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKDateTime } from "@/lib/format";
import { DepositMatchControl } from "@/components/DepositMatchControl";
import { lastBankSyncAt } from "@/lib/bank";
import { SubmitButton } from "@/components/SubmitButton";
import { approveSplitAction, rejectSplitAction } from "@/app/actions/invoice";
import { suggestStoresForDeposits } from "@/lib/deposit-suggest";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 입금 관리 = 핫딜마켓 가맹점별 '남은 결제잔액(미입금액)' 현황. 날짜 개념 없음.
// 점포를 누르면 그 점포의 통장식 청구/입금 내역(/admin/deposits/[userId])로.
export default async function AdminDeposits() {
  await requireAdmin();

  const [stores, balances, splitReqs, unmatched, syncedAt, pendingSplits] =
    await Promise.all([
    prisma.user.findMany({
      where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
      select: { id: true, storeName: true, payerNames: true },
      orderBy: { storeName: "asc" },
    }),
    // 미입금 계산서(ISSUED) 합 = 남은 결제잔액 (마이페이지·발주잠금과 동일 기준)
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { status: "ISSUED", kind: "DAILY" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.invoice.findMany({
      where: { status: "ISSUED", kind: "DAILY", splitRequested: true, splitApprovedAt: null },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.deposit.findMany({
      where: { matchStatus: "UNMATCHED" },
      orderBy: { txAt: "desc" },
      take: 100,
    }),
    lastBankSyncAt(),
    // 미처리 분할 입금 요청(승인/반려 대기) — 계산서 단위
    prisma.invoice.findMany({
      where: { status: "ISSUED", splitRequested: true, splitApprovedAt: null },
      select: {
        id: true,
        date: true,
        total: true,
        user: { select: { storeName: true } },
      },
      orderBy: { splitRequestedAt: "asc" },
    }),
  ]);

  const balByUser = new Map(
    balances.map((b) => [b.userId, { sum: b._sum.total ?? 0, count: b._count }]),
  );
  const splitSet = new Set(splitReqs.map((s) => s.userId));

  const rows = stores
    .map((s) => ({
      id: s.id,
      storeName: s.storeName,
      payer: s.payerNames[0] ?? "미등록",
      balance: balByUser.get(s.id)?.sum ?? 0,
      count: balByUser.get(s.id)?.count ?? 0,
      split: splitSet.has(s.id),
    }))
    .sort(
      (a, b) => b.balance - a.balance || a.storeName.localeCompare(b.storeName),
    );

  const totalDue = rows.reduce((n, r) => n + r.balance, 0);
  const dueStores = rows.filter((r) => r.balance > 0).length;

  // 미매칭 입금(예금주 미등록) 매칭용 점포 옵션
  const merchants = await prisma.user.findMany({
    where: {
      role: { in: ["MERCHANT_HOTDEAL", "MERCHANT_SEOBU"] },
      status: "APPROVED",
    },
    select: { id: true, storeName: true },
    orderBy: { storeName: "asc" },
  });
  const storeOpts = merchants.map((m) => ({ id: m.id, label: m.storeName }));

  // 미매칭 입금 → 점포 자동 제안(유일하게 특정될 때만)
  const suggestions = await suggestStoresForDeposits(
    unmatched.map((d) => ({ id: d.id, payerName: d.payerName, amount: d.amount })),
  );

  return (
    <>
      <Topbar backHref="/admin" title="입금 관리" />
      <div className="page">
        <p className="lead" style={{ marginTop: 0, marginBottom: 4 }}>
          미수 {dueStores}건 · 합계 {fmt(totalDue)}원
        </p>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          최신 계좌 동기화 : {syncedAt ? formatKDateTime(syncedAt) : "동기화 전"}
        </p>

        {pendingSplits.length > 0 && (
          <>
            <div className="section-label">
              분할 입금 요청 ({pendingSplits.length})
            </div>
            <div className="list">
              {pendingSplits.map((s) => (
                <div className="deprow" key={s.id}>
                  <div className="deprow__head">
                    <div className="row__main">
                      <div className="row__title">
                        {s.user.storeName} · {fmt(s.total)}원
                      </div>
                      <div className="row__sub">{s.date} 계산서</div>
                    </div>
                    <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                      <form action={approveSplitAction}>
                        <input type="hidden" name="invoiceId" value={s.id} />
                        <SubmitButton
                          className="btn btn--xs btn--primary"
                          pendingText="…"
                        >
                          승인
                        </SubmitButton>
                      </form>
                      <form action={rejectSplitAction}>
                        <input type="hidden" name="invoiceId" value={s.id} />
                        <SubmitButton
                          className="btn btn--xs btn--ghost"
                          pendingText="…"
                        >
                          반려
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="section-label">가맹점</div>
        <div className="list">
          {rows.map((r) => (
            <Link href={`/admin/deposits/${r.id}`} className="row" key={r.id}>
              <div className="row__main">
                <div className="row__title">
                  {r.storeName}
                  {r.split && (
                    <span className="badge badge--wait" style={{ marginLeft: 8 }}>
                      분할요청
                    </span>
                  )}
                </div>
                <div className="row__sub">입금자 {r.payer}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                {r.balance > 0 ? (
                  <div
                    style={{
                      color: "var(--danger)",
                      fontWeight: 800,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {fmt(r.balance)}원
                  </div>
                ) : (
                  <span className="badge badge--ok">완납</span>
                )}
              </div>
            </Link>
          ))}
        </div>

        <div className="section-label">미매칭 입금</div>
        {unmatched.length === 0 ? (
          <div className="empty">
            <p>매칭할 미매칭 입금이 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {unmatched.map((d) => (
                <div className="deprow" key={d.id}>
                  <div className="deprow__head">
                    <div className="row__main">
                      <div className="row__title">
                        {d.payerName || "(입금자명 없음)"} · {fmt(d.amount)}원
                      </div>
                      <div className="row__sub">
                        {formatKDateTime(d.txAt)}
                        {suggestions.get(d.id) && (
                          <span style={{ color: "var(--black)", marginLeft: 6 }}>
                            · {suggestions.get(d.id)!.reason}
                          </span>
                        )}
                      </div>
                    </div>
                    <DepositMatchControl
                      depositId={d.id}
                      payerName={d.payerName}
                      amount={d.amount}
                      stores={storeOpts}
                      suggestion={suggestions.get(d.id)}
                    />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </>
  );
}
