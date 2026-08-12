import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { labelDate, kstDateOf } from "@/lib/date";
import { receivableOf } from "@/lib/receivable";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 점주 입출금 내역(읽기 전용) — 관리자 입금관리의 그 지점 통장식 내역과 동일한 '청구(입금요청)·입금·조정' 흐름을
// 자기 지점 것만 보여준다. 수정·삭제·매칭 등 어떤 변경 기능도 없다(순수 조회). 사다드림은 별도 트랙이라 제외.
type LedgerRow =
  | { kind: "invoice"; key: string; at: Date; date: string; amount: number; splitRequested: boolean; invKind: string }
  | { kind: "deposit"; key: string; at: Date; amount: number; payer: string }
  | { kind: "adjust"; key: string; at: Date; amount: number; memo: string };

export default async function MerchantTransactionsPage(props: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireMerchant(); // 로그인한 본인 — 파라미터 없음(남의 내역 조회 불가)
  const { q = "" } = await props.searchParams;
  const query = q.trim();

  const [invoices, deposits, ar, adjustments] = await Promise.all([
    // 청구(발행) 내역 — 잔액이 총 미수와 맞도록 전 종류(일반·주간·환불) 포함, 사다드림(별도 트랙)만 제외.
    prisma.invoice.findMany({
      where: { userId: user.id, status: { in: ["ISSUED", "PAID"] }, kind: { not: "SADADREAM" } },
      select: { id: true, date: true, total: true, status: true, splitRequested: true, issuedAt: true, createdAt: true, kind: true },
      orderBy: { createdAt: "desc" },
      take: 500, // 최근 500건만(미수 잔액은 receivableOf 로 별도 합산 → 목록 캡과 무관하게 정확).
    }),
    // 입금 내역 — 이 지점으로 매칭된 입금(관리자가 매칭). 미매칭 입금은 아직 이 지점 것으로 확정 전이라 제외.
    prisma.deposit.findMany({
      where: { matchedUserId: user.id, matchStatus: { in: ["AUTO", "MANUAL"] } },
      select: { id: true, txAt: true, amount: true, payerName: true },
      orderBy: { txAt: "desc" },
      take: 500,
    }),
    receivableOf(user.id),
    prisma.receivableAdjustment.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, amount: true, memo: true, createdAt: true, depositId: true },
    }),
  ]);

  // 수동 조정(내역 행으로 표시)과 입금매칭 조정(입금 행의 잔액 반영용)으로 분리.
  const manualAdjustments = adjustments.filter((a) => !a.depositId);
  const depositMatchAmt = new Map<string, number>();
  for (const a of adjustments) if (a.depositId) depositMatchAmt.set(a.depositId, a.amount);

  const rows: LedgerRow[] = [
    ...invoices.map(
      (i): LedgerRow => ({
        kind: "invoice",
        key: `inv-${i.id}`,
        at: i.issuedAt ?? i.createdAt,
        date: i.date,
        amount: i.total,
        splitRequested: i.splitRequested,
        invKind: i.kind,
      }),
    ),
    ...deposits.map(
      (d): LedgerRow => ({ kind: "deposit", key: `dep-${d.id}`, at: d.txAt, amount: d.amount, payer: d.payerName || "입금" }),
    ),
    ...manualAdjustments.map(
      (a): LedgerRow => ({ kind: "adjust", key: `adj-${a.id}`, at: a.createdAt, amount: a.amount, memo: a.memo || "조정" }),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // 각 시점의 미수 잔액(running balance) — receivableOf(=ISSUED 계산서 합 + 조정 합)와 동일 구성으로 누적.
  //   · 계산서: ISSUED만(DRAFT 제외), total 그대로(환불은 음수).
  //   · 입금: 그 입금의 매칭 조정 금액(−입금액)만 반영. 조정 없는 레거시 입금은 잔액 불변(줄 없음).
  //   · 수동 조정: amount(±).
  type BalEvent = { key: string; at: Date; delta: number };
  const balEvents: BalEvent[] = [
    ...invoices
      .filter((i) => i.status === "ISSUED")
      .map((i): BalEvent => ({ key: `inv-${i.id}`, at: i.issuedAt ?? i.createdAt, delta: i.total })),
    ...deposits
      .filter((d) => depositMatchAmt.has(d.id))
      .map((d): BalEvent => ({ key: `dep-${d.id}`, at: d.txAt, delta: depositMatchAmt.get(d.id)! })),
    ...manualAdjustments.map((a): BalEvent => ({ key: `adj-${a.id}`, at: a.createdAt, delta: a.amount })),
  ];
  const balDeltaSum = balEvents.reduce((n, e) => n + e.delta, 0);
  const openingBalance = ar.balance - balDeltaSum;
  const balanceAfter = new Map<string, number>();
  {
    let run = openingBalance;
    for (const e of [...balEvents].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      run += e.delta;
      balanceAfter.set(e.key, run);
    }
  }
  const balanceLine = (key: string) => {
    const bal = balanceAfter.get(key);
    if (bal === undefined) return null;
    return (
      <div
        className="row__sub"
        style={{ marginTop: 2, fontWeight: 700, fontVariantNumeric: "tabular-nums", color: bal > 0 ? "var(--danger)" : "var(--green-700)" }}
      >
        {bal < 0 ? `선입금 ${fmt(-bal)}원` : `미수 ${fmt(bal)}원`}
      </div>
    );
  };

  // 날짜/금액 검색 + 날짜별 그룹핑
  const digits = query.replace(/[^0-9]/g, "");
  const filtered = query
    ? rows.filter((r) => {
        const d = kstDateOf(r.at);
        return d.includes(query) || (digits !== "" && String(Math.abs(r.amount)).includes(digits));
      })
    : rows;
  const byDate = new Map<string, LedgerRow[]>();
  for (const r of filtered) {
    const d = kstDateOf(r.at);
    const arr = byDate.get(d);
    if (arr) arr.push(r);
    else byDate.set(d, [r]);
  }
  const dateKeys = [...byDate.keys()].sort((a, b) => (a < b ? 1 : -1));

  return (
    <>
      <Topbar backHref="/mypage" title="입출금 내역" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">남은 결제잔액 (미수)</div>
          <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4, color: ar.balance > 0 ? "var(--danger)" : "var(--green-700)" }}>
            {fmt(ar.balance)}원
          </div>
          <div className="row__sub" style={{ marginTop: 2 }}>
            청구·입금·조정 내역 (조회 전용)
          </div>
        </div>

        <form method="get" style={{ marginBottom: 12 }}>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="날짜(예: 07-01) 또는 금액 검색"
            className="input"
            style={{ width: "100%" }}
          />
        </form>

        {filtered.length === 0 ? (
          <div className="empty">
            <p>{query ? "검색 결과가 없어요." : "아직 청구·입금 내역이 없어요."}</p>
          </div>
        ) : (
          dateKeys.map((dk) => (
            <div key={dk} style={{ marginBottom: 16 }}>
              <div className="row__sub" style={{ fontWeight: 800, color: "var(--fg)", margin: "0 2px 6px" }}>
                {labelDate(dk)}
              </div>
              <div className="list">
                {byDate.get(dk)!.map((r) => {
                  if (r.kind === "invoice") {
                    const credit = r.amount < 0; // 환불 등 미수 감소분
                    return (
                      <div className="row" key={r.key}>
                        <div className="row__main">
                          <div className="row__title">
                            {r.invKind === "REFUND" ? "환불" : "입금 요청"}
                            {r.invKind === "WEEKLY" && (
                              <span className="badge badge--wait" style={{ marginLeft: 8 }}>주간</span>
                            )}
                            {r.splitRequested && (
                              <span className="badge badge--wait" style={{ marginLeft: 8 }}>분할요청</span>
                            )}
                          </div>
                          <div className="row__sub">{labelDate(r.date)} 청구</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className={credit ? "ledger__pay" : "ledger__req"}>
                            {credit ? "−" : "+"}
                            {fmt(Math.abs(r.amount))}원
                          </div>
                          {balanceLine(r.key)}
                        </div>
                      </div>
                    );
                  }
                  if (r.kind === "deposit") {
                    return (
                      <div className="row" key={r.key}>
                        <div className="row__main">
                          <div className="row__title">입금 · {r.payer}</div>
                          <div className="row__sub">입금 확인됨</div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="ledger__pay">−{fmt(r.amount)}원</div>
                          {balanceLine(r.key)}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="row" key={r.key}>
                      <div className="row__main">
                        <div className="row__title">미수 조정</div>
                        <div className="row__sub">{r.memo}</div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className={r.amount > 0 ? "ledger__req" : "ledger__pay"}>
                          {r.amount > 0 ? "+" : "−"}
                          {fmt(Math.abs(r.amount))}원
                        </div>
                        {balanceLine(r.key)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        {!query && openingBalance !== 0 && filtered.length > 0 && (
          <div className="row__sub" style={{ textAlign: "center", marginTop: 4, color: "var(--muted)" }}>
            이전 이월 미수 {fmt(openingBalance)}원
          </div>
        )}
      </div>
    </>
  );
}
