import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { labelDate, kstDateOf } from "@/lib/date";
import {
  receivableOf,
  orderLockOf,
  isUnlockActiveThisWindow,
} from "@/lib/receivable";
import { setOrderUnlockAction } from "@/app/actions/deposit";
import { ReceivableAdjustControl } from "@/components/ReceivableAdjustControl";
import { DepositUnmatchButton } from "@/components/DepositUnmatchButton";
import { ReceivableAdjustDeleteButton } from "@/components/ReceivableAdjustDeleteButton";
import { SubmitButton } from "@/components/SubmitButton";
import {
  confirmSadadreamPaidAction,
  unconfirmSadadreamPaidAction,
} from "@/app/actions/sadadream";

const fmt = (n: number) => n.toLocaleString("ko-KR");

type LedgerRow =
  | {
      kind: "invoice";
      at: Date;
      date: string;
      amount: number; // 계산서 total(환불은 음수)
      id: string;
      status: string;
      splitRequested: boolean;
      invKind: string; // DAILY | WEEKLY | REFUND … (미수는 종류 합산이라 전부 표시)
    }
  | {
      kind: "deposit";
      at: Date;
      amount: number;
      payer: string;
      via: string;
      manual: boolean;
      depositId: string;
    }
  | {
      kind: "adjust";
      at: Date;
      amount: number; // 수동 미수 조정(±)
      memo: string;
      adminName: string;
      id: string;
    };

// 점포 입출금 내역 — 통장 거래내역처럼 날짜순으로 '입금 요청(청구)'와 '입금'을 나열.
export default async function AdminDepositStore(props: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { userId } = await props.params;
  const { q = "" } = await props.searchParams;
  const query = q.trim();

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.role !== "MERCHANT_HOTDEAL") notFound();

  const [invoices, deposits, ar, lock, adjustments, sadadream] = await Promise.all([
    // 미수(receivableOf)는 종류 무관 ISSUED 계산서 전체를 합산하므로, 입출금 내역도 전 종류
    // (일반 DAILY·주간 WEEKLY·환불 REFUND)를 보여야 잔액이 헤더(총 미수)와 정확히 맞는다.
    // 단 사다드림(SADADREAM)은 별도 트랙이라 일반 원장/잔액에서 제외하고 아래 별도 섹션으로 뺀다.
    prisma.invoice.findMany({
      // ISSUED(미수 대상) + PAID(레거시 정산분)만. DRAFT(작성 중)는 아직 청구가 아니라 제외.
      where: { userId, status: { in: ["ISSUED", "PAID"] }, kind: { not: "SADADREAM" } },
      select: {
        id: true,
        date: true,
        total: true,
        status: true,
        splitRequested: true,
        issuedAt: true,
        createdAt: true,
        kind: true,
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
        bankTid: true,
      },
    }),
    receivableOf(userId),
    orderLockOf(userId, user.orderUnlock, user.orderUnlockAt),
    // 미수 조정 전체(수동 + 입금매칭). 수동(depositId=null)은 입출금 내역에 '미수 조정' 행으로 표시하고,
    // 입금매칭(depositId≠null)은 해당 입금 행의 잔액 반영에 쓴다(입금 −금액을 조정 기준으로 계산해 정확히 상쇄).
    prisma.receivableAdjustment.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, amount: true, memo: true, adminName: true, createdAt: true, depositId: true },
    }),
    // 사다드림 계산서(별도 트랙) — 발행/입금완료. 입금확인은 여기서 낱장 단위로 따로 처리(우리 계좌 입금 아님).
    prisma.invoice.findMany({
      where: { userId, kind: "SADADREAM", status: { in: ["ISSUED", "PAID"] } },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, date: true, total: true, status: true, sdBank: true, sdHolder: true, sdAccount: true },
    }),
  ]);
  const sdIssued = sadadream.filter((s) => s.status === "ISSUED");
  const sdBalance = sdIssued.reduce((n, s) => n + s.total, 0);

  // 수동 조정(내역 표시용)과 입금매칭 조정(입금별 금액 맵)으로 분리.
  const manualAdjustments = adjustments.filter((a) => !a.depositId);
  const depositMatchAmt = new Map<string, number>();
  for (const a of adjustments) if (a.depositId) depositMatchAmt.set(a.depositId, a.amount);

  // 수동 해제가 '이번 발주창'에 유효한지(1회성). orderLockOf와 동일한 창-키 판정 공유.
  const unlockedThisWindow = isUnlockActiveThisWindow(
    user.orderUnlock,
    user.orderUnlockAt,
  );

  // 총 청구 = 발행(ISSUED) 계산서 합(레거시 PAID 제외), 총 입금 = 미수에 반영된(매칭조정 있는) 입금 합.
  const totalBilled = invoices
    .filter((i) => i.status === "ISSUED")
    .reduce((n, i) => n + i.total, 0);
  const totalPaid = deposits
    .filter((d) => depositMatchAmt.has(d.id))
    .reduce((n, d) => n + d.amount, 0);

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
        invKind: i.kind,
      }),
    ),
    ...deposits.map(
      (d): LedgerRow => ({
        kind: "deposit",
        at: d.txAt,
        amount: d.amount,
        payer: d.payerName || "(입금자명 없음)",
        via: d.matchStatus === "AUTO" ? "자동" : "수동",
        manual: d.bankTid.startsWith("manual-"),
        depositId: d.id,
      }),
    ),
    ...manualAdjustments.map(
      (a): LedgerRow => ({
        kind: "adjust",
        at: a.createdAt,
        amount: a.amount,
        memo: a.memo || "사유 없음",
        adminName: a.adminName || "관리자",
        id: a.id,
      }),
    ),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  // 각 시점의 미수 잔액(running balance). 미수 = '발행 계산서(전 종류, +total) + 미수 조정(±) + 입금매칭(−)'의 누적으로,
  // receivableOf(=ISSUED 계산서 합 + 조정 합)와 정확히 같은 구성이다. 시간 오름차순으로 쌓아 '그 작업 직후' 잔액을 만든다.
  //   · 계산서: ISSUED만(작성중 DRAFT 제외), total 그대로(환불 REFUND은 음수라 자동 차감).
  //   · 입금: 그 입금의 '매칭 조정' 금액을 델타로 쓴다(정상 매칭=−입금액). 조정 없는 레거시 자동매칭 입금은 0(미수 불변).
  //   · 수동 조정: amount(±) 그대로.
  // → balDeltaSum이 ar.balance와 같아 openingBalance=0(정상). 최신 사건 직후 잔액 = 현재 미수와 일치.
  //   앱 도입 이전의 낱건은 복원 불가 → 혹시 남는 차액이 있으면 openingBalance(이전 이월) 한 줄로만 표시.
  type BalEvent = { key: string; at: Date; delta: number };
  const balEvents: BalEvent[] = [
    ...invoices
      .filter((i) => i.status === "ISSUED")
      .map((i): BalEvent => ({ key: `inv-${i.id}`, at: i.issuedAt ?? i.createdAt, delta: i.total })),
    // 미수에 반영된 입금만(매칭조정 있는 것). 레거시 자동매칭·합성 입금은 조정이 없어 현재 미수에 영향 없음 → 잔액줄 없이 표시.
    ...deposits
      .filter((d) => depositMatchAmt.has(d.id))
      .map((d): BalEvent => ({ key: `dep-${d.id}`, at: d.txAt, delta: depositMatchAmt.get(d.id)! })),
    ...manualAdjustments.map((a): BalEvent => ({ key: `adj-${a.id}`, at: a.createdAt, delta: a.amount })),
  ];
  const balDeltaSum = balEvents.reduce((n, e) => n + e.delta, 0);
  const openingBalance = ar.balance - balDeltaSum; // 추적 전 이월(데이터 정합 시 0)
  const balanceAfter = new Map<string, number>();
  {
    let run = openingBalance;
    for (const e of [...balEvents].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      run += e.delta;
      balanceAfter.set(e.key, run);
    }
  }
  // 한 행의 '그 시점 미수' 표시(빨강=미수 남음 / 초록=0 / '선입금'=음수=과입금).
  const balanceLine = (key: string) => {
    const bal = balanceAfter.get(key);
    if (bal === undefined) return null;
    return (
      <div
        className="row__sub"
        style={{
          marginTop: 2,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          color: bal > 0 ? "var(--danger)" : "var(--green-700)",
        }}
      >
        {bal < 0 ? `선입금 ${fmt(-bal)}원` : `미수 ${fmt(bal)}원`}
      </div>
    );
  };

  // #5 날짜/금액 검색 + 날짜별 그룹핑
  const digits = query.replace(/[^0-9]/g, "");
  const filtered = query
    ? rows.filter((r) => {
        const d = kstDateOf(r.at);
        return d.includes(query) || (digits !== "" && String(r.amount).includes(digits));
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
      <Topbar backHref="/admin/deposits" title={user.storeName} />
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
          <div
            style={{
              marginTop: 12,
              display: "flex",
              gap: 8,
              alignItems: "center",
            }}
          >
            <span
              className={`badge ${
                lock.locked
                  ? "badge--danger"
                  : unlockedThisWindow
                    ? "badge--wait"
                    : "badge--ok"
              }`}
              style={{ minHeight: 36, padding: "0 16px", fontSize: 13, borderRadius: 999 }}
            >
              {lock.locked
                ? "발주 잠김"
                : unlockedThisWindow
                  ? "이번 발주창 해제"
                  : "발주 정상"}
            </span>
            <form action={setOrderUnlockAction} style={{ margin: 0 }}>
              <input type="hidden" name="userId" value={userId} />
              <input
                type="hidden"
                name="unlock"
                value={unlockedThisWindow ? "false" : "true"}
              />
              <button
                type="submit"
                className="btn btn--xs btn--soft"
                style={{ minHeight: 36 }}
              >
                {unlockedThisWindow ? "발주 다시 잠금" : "발주 1회 잠금 해제"}
              </button>
            </form>
          </div>
        </div>

        <ReceivableAdjustControl userId={userId} currentBalance={ar.balance} />

        {/* 사다드림(별도 트랙) — 우리 계좌 입금이 아니라 낱장 단위로 따로 입금확인. 전체 미수와 무관. */}
        {sadadream.length > 0 && (
          <div style={{ marginBottom: 18 }}>
            <div className="spread section-label">
              <span>사다드림 미수</span>
              <b style={{ color: "#2563eb", fontVariantNumeric: "tabular-nums" }}>
                {fmt(sdBalance)}원
              </b>
            </div>
            <div className="list">
              {sadadream.map((s) => {
                const acct = [s.sdBank, s.sdHolder, s.sdAccount].filter(Boolean).join(" ");
                return (
                  <div className="row" key={`sd-${s.id}`}>
                    <div className="row__main">
                      <Link
                        href={`/admin/invoices/${s.id}`}
                        className="row__title"
                        style={{ textDecoration: "none" }}
                      >
                        사다드림 · {fmt(s.total)}원
                        {s.status === "PAID" && (
                          <span className="badge badge--ok" style={{ marginLeft: 8 }}>
                            입금완료
                          </span>
                        )}
                      </Link>
                      <div className="row__sub">
                        {labelDate(s.date)}
                        {acct ? ` · ${acct}` : ""}
                      </div>
                    </div>
                    <div style={{ textAlign: "right", flexShrink: 0 }}>
                      {s.status === "ISSUED" ? (
                        <form action={confirmSadadreamPaidAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton className="btn btn--xs btn--primary" pendingText="…">
                            입금확인
                          </SubmitButton>
                        </form>
                      ) : (
                        <form action={unconfirmSadadreamPaidAction}>
                          <input type="hidden" name="id" value={s.id} />
                          <SubmitButton className="btn btn--xs btn--ghost" pendingText="…">
                            입금확인 취소
                          </SubmitButton>
                        </form>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="section-label">입출금 내역</div>
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
              <div
                className="row__sub"
                style={{ fontWeight: 800, color: "var(--fg)", margin: "0 2px 6px" }}
              >
                {labelDate(dk)}
              </div>
              <div className="list">
                {byDate.get(dk)!.map((r) => {
                  if (r.kind === "invoice") {
                    const credit = r.amount < 0; // 환불 등 미수 감소분
                    return (
                      <div className="row" key={`inv-${r.id}`}>
                        <div className="row__main">
                          <Link
                            href={`/admin/invoices/${r.id}`}
                            className="row__title"
                            style={{ textDecoration: "none" }}
                          >
                            {r.invKind === "REFUND" ? "환불" : "입금 요청"}
                            {r.invKind === "WEEKLY" && (
                              <span className="badge badge--wait" style={{ marginLeft: 8 }}>
                                주간
                              </span>
                            )}
                            {r.splitRequested && (
                              <span className="badge badge--wait" style={{ marginLeft: 8 }}>
                                분할요청
                              </span>
                            )}
                          </Link>
                          <div className="row__sub">
                            {r.status === "PAID" ? "입금 완료" : "발행"}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className={credit ? "ledger__pay" : "ledger__req"}>
                            {credit ? "−" : "+"}
                            {fmt(Math.abs(r.amount))}원
                          </div>
                          {balanceLine(`inv-${r.id}`)}
                        </div>
                      </div>
                    );
                  }
                  if (r.kind === "deposit") {
                    return (
                      <div className="row" key={`dep-${r.depositId}`}>
                        <div className="row__main">
                          <div className="row__title">
                            {r.manual ? "수동입금확인" : `입금 · ${r.payer}`}
                          </div>
                          <div className="row__sub">
                            {r.manual ? "관리자 확인" : `${r.via} 매칭`}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div className="ledger__pay">−{fmt(r.amount)}원</div>
                          {balanceLine(`dep-${r.depositId}`)}
                          {!r.manual && (
                            <div style={{ marginTop: 6 }}>
                              <DepositUnmatchButton depositId={r.depositId} />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  // 미수 조정(수동) — 관리자 가감(+ 증가 / − 감소)
                  const plus = r.amount > 0;
                  return (
                    <div className="row" key={`adj-${r.id}`}>
                      <div className="row__main">
                        <div className="row__title">미수 조정</div>
                        <div className="row__sub">
                          {r.memo} · {r.adminName}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div className={plus ? "ledger__req" : "ledger__pay"}>
                          {plus ? "+" : "−"}
                          {fmt(Math.abs(r.amount))}원
                        </div>
                        {balanceLine(`adj-${r.id}`)}
                        <div style={{ marginTop: 6 }}>
                          <ReceivableAdjustDeleteButton id={r.id} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
        {/* 앱 도입 이전의 미수는 낱건으로 못 남긴다 → 시작 잔액이 있으면 한 줄로만 표시(그 위 행부터 누적). */}
        {!query && openingBalance !== 0 && filtered.length > 0 && (
          <div
            className="row__sub"
            style={{ textAlign: "center", marginTop: 4, color: "var(--muted)" }}
          >
            이전 이월 미수 {fmt(openingBalance)}원 · 앱 도입 전 기록은 낱건으로 남지 않아요
          </div>
        )}
      </div>
    </>
  );
}
