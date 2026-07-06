import Link from "next/link";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday, kstDayRange, labelDate } from "@/lib/date";
import { formatKDateTime } from "@/lib/format";
import { DepositMatchControl } from "@/components/DepositMatchControl";
import { ManualPayButton } from "@/components/ManualPayButton";
import { setOrderUnlockAction } from "@/app/actions/deposit";
import { lastBankSyncAt } from "@/lib/bank";

const fmt = (n: number) => n.toLocaleString("ko-KR");

export default async function AdminDeposits() {
  await requireAdmin();
  const today = kstToday();
  const { start: todayStart } = kstDayRange(today);

  // 핫딜마켓 가맹점의 미입금(ISSUED) 전체 + 오늘 입금완료(PAID)
  const [unpaidInv, paidTodayInv, franchises] = await Promise.all([
    prisma.invoice.findMany({
      where: { status: "ISSUED", user: { role: "MERCHANT_HOTDEAL" } },
      include: {
        user: { select: { storeName: true, payerNames: true, orderUnlock: true } },
      },
      orderBy: { date: "asc" },
    }),
    prisma.invoice.findMany({
      where: {
        status: "PAID",
        paidAt: { gte: todayStart },
        user: { role: "MERCHANT_HOTDEAL" },
      },
      include: { user: { select: { storeName: true, payerNames: true } } },
      orderBy: { paidAt: "desc" },
    }),
    prisma.user.findMany({
      where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
      select: { id: true },
    }),
  ]);

  const franchiseIds = franchises.map((f) => f.id);

  // 매칭됐지만 '아직 어느 계산서에도 소진(귀속)되지 않은' 입금만 차액 계산에 쓴다.
  // (이미 완납 처리된 계산서에 귀속된 입금은 appliedInvoiceId가 있어 제외 → 중복합산 방지)
  const matchedDeps = await prisma.deposit.findMany({
    where: {
      matchStatus: { in: ["AUTO", "MANUAL"] },
      appliedInvoiceId: null,
      matchedUserId: { in: franchiseIds.length ? franchiseIds : ["_none_"] },
    },
    select: { matchedUserId: true, amount: true, txAt: true },
  });
  const depsByStore = new Map<string, { amount: number; txAt: Date }[]>();
  for (const d of matchedDeps) {
    if (!d.matchedUserId) continue;
    const list = depsByStore.get(d.matchedUserId) ?? [];
    list.push({ amount: d.amount, txAt: d.txAt });
    depsByStore.set(d.matchedUserId, list);
  }
  // 그 계산서 '당일'에 그 점포로 들어온 미소진 매칭 입금 합(다른 날짜 입금은 안 셈)
  function depositedFor(userId: string, date: string): number {
    const { start, end } = kstDayRange(date);
    return (depsByStore.get(userId) ?? [])
      .filter((d) => d.txAt >= start && d.txAt < end)
      .reduce((n, d) => n + d.amount, 0);
  }

  // 아직 어느 점포와도 매칭되지 않은 입금(예금주 미등록 등) — 수동 큐
  const [unmatched, merchants] = await Promise.all([
    prisma.deposit.findMany({
      where: { matchStatus: "UNMATCHED" },
      orderBy: { txAt: "desc" },
      take: 100,
    }),
    prisma.user.findMany({
      where: { role: { in: ["MERCHANT_HOTDEAL", "MERCHANT_SEOBU"] }, status: "APPROVED" },
      select: { id: true, storeName: true },
      orderBy: { storeName: "asc" },
    }),
  ]);
  const stores = merchants.map((m) => ({ id: m.id, label: m.storeName }));
  const syncedAt = await lastBankSyncAt();

  return (
    <>
      <header className="topbar">
        <Link href="/admin" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">입금 관리</div>
      </header>
      <div className="page">
        <p className="lead" style={{ marginTop: 0, marginBottom: 4 }}>
          {labelDate(today)} · 미입금 {unpaidInv.length} · 입금 완료{" "}
          {paidTodayInv.length}
        </p>
        <p className="hint" style={{ marginTop: 0, marginBottom: 14 }}>
          최신 계좌 동기화 : {syncedAt ? formatKDateTime(syncedAt) : "동기화 전"}
        </p>

        <div className="section-label">미입금</div>
        {unpaidInv.length === 0 ? (
          <div className="empty">
            <p>미입금 점포가 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {unpaidInv.map((inv) => {
              const dep = depositedFor(inv.userId, inv.date);
              const diff = inv.total - dep;
              return (
                <div className="deprow" key={inv.id}>
                  <div className="deprow__head">
                    <div className="row__main">
                      <div className="row__title">
                        {inv.user.storeName}
                        {inv.splitRequested && (
                          <span
                            className="badge badge--wait"
                            style={{ marginLeft: 8 }}
                          >
                            분할요청
                          </span>
                        )}
                      </div>
                      <div className="row__sub">
                        입금자 {inv.user.payerNames[0] ?? "미등록"} · 요청{" "}
                        {fmt(inv.total)}원
                        {inv.date !== today ? ` · ${labelDate(inv.date)}` : ""}
                      </div>
                      <div
                        className="row__sub"
                        style={{
                          color: dep > 0 ? "var(--warn)" : "var(--danger)",
                          fontWeight: 700,
                        }}
                      >
                        {dep <= 0
                          ? `미입금액 ${fmt(inv.total)}원`
                          : diff > 0
                            ? `미입금액 ${fmt(diff)}원 (입금 ${fmt(dep)}원)`
                            : `입금 ${fmt(dep)}원 확인 필요`}
                      </div>
                    </div>
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 6,
                        alignItems: "flex-end",
                      }}
                    >
                      <ManualPayButton invoiceId={inv.id} />
                      <form action={setOrderUnlockAction}>
                        <input type="hidden" name="userId" value={inv.userId} />
                        <input
                          type="hidden"
                          name="unlock"
                          value={inv.user.orderUnlock ? "false" : "true"}
                        />
                        <button type="submit" className="btn btn--xs btn--soft">
                          {inv.user.orderUnlock ? "발주 다시 잠금" : "발주 잠금 해제"}
                        </button>
                      </form>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {paidTodayInv.length > 0 && (
          <>
            <div className="section-label">입금 완료 · 오늘</div>
            <div className="list">
              {paidTodayInv.map((inv) => (
                <div className="row" key={inv.id}>
                  <div className="row__main">
                    <div className="row__title">{inv.user.storeName}</div>
                    <div className="row__sub">
                      입금자 {inv.user.payerNames[0] ?? "미등록"} ·{" "}
                      {fmt(inv.total)}원
                      {inv.manualPaid ? " · 수동" : ""}
                    </div>
                  </div>
                  <span className="badge badge--ok">입금 완료</span>
                </div>
              ))}
            </div>
          </>
        )}

        {unmatched.length > 0 && (
          <>
            <div className="section-label">미매칭 입금 (예금주 미등록)</div>
            <div className="list">
              {unmatched.map((d) => (
                <div className="deprow" key={d.id}>
                  <div className="deprow__head">
                    <div className="row__main">
                      <div className="row__title">
                        {d.payerName || "(입금자명 없음)"} · {fmt(d.amount)}원
                      </div>
                      <div className="row__sub">{formatKDateTime(d.txAt)}</div>
                    </div>
                    <DepositMatchControl
                      depositId={d.id}
                      payerName={d.payerName}
                      stores={stores}
                    />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
