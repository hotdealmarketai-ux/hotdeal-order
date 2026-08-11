import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { formatKDateTime } from "@/lib/format";
import { DepositMatchControl } from "@/components/DepositMatchControl";
import { CollectDepositsButton } from "@/components/CollectDepositsButton";
import { SubmitButton } from "@/components/SubmitButton";
import { approveSplitAction, rejectSplitAction } from "@/app/actions/invoice";
import { setOrderLockOverrideAction } from "@/app/actions/deposit";
import { orderLockOverride } from "@/lib/order-open";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// '지금 수집' 서버액션이 팝빌 계좌조회(잡 폴링 최대 ~30초)를 기다리므로 함수 제한시간을 늘린다.
// (크론 라우트도 동일하게 maxDuration=60. 없으면 기본 10~15초에서 잘려 결과가 안 뜬다.)
export const maxDuration = 60;

// 입금 관리 = 핫딜마켓 가맹점별 '남은 결제잔액(미입금액)' 현황. 날짜 개념 없음.
// 점포를 누르면 그 점포의 통장식 청구/입금 내역(/admin/deposits/[userId])로.
export default async function AdminDeposits() {
  await requireAdmin();

  const [stores, balances, splitReqs, txns, pendingSplits, adjustments, sdBalances] =
    await Promise.all([
    prisma.user.findMany({
      where: { role: "MERCHANT_HOTDEAL", status: "APPROVED" },
      select: { id: true, storeName: true, payerNames: true },
      orderBy: { storeName: "asc" },
    }),
    // 미입금 계산서(ISSUED) 합 = 남은 결제잔액. receivableOf(마이·점포상세)와 동일하게 전 종류(일반+주간) 합산.
    // 사다드림(우리 계좌 아님·별도 트랙)은 제외 — 아래 sdBalances 로 따로 집계.
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { status: "ISSUED", kind: { not: "SADADREAM" } },
      _sum: { total: true },
      _count: true,
    }),
    prisma.invoice.findMany({
      where: { status: "ISSUED", kind: "DAILY", splitRequested: true, splitApprovedAt: null },
      select: { userId: true },
      distinct: ["userId"],
    }),
    // 입출금내역(처리 대기 큐) — 아직 매칭 안 된 미매칭 입금만. 매칭하면 이 목록에서 사라지고
    // 그 지점 상세 원장으로 이동(거기서 '매칭 해제'로 되돌릴 수 있음).
    prisma.deposit.findMany({
      where: { matchStatus: "UNMATCHED" },
      orderBy: { txAt: "desc" },
      take: 300,
    }),
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
    // 미수 조정(ReceivableAdjustment) 점포별 합계 — 파생 미수에 가산.
    // 조정에는 수동 조정 + 입금 매칭 조정(−금액)이 함께 들어가므로, 매칭된 입금은 여기서 자동으로 미수를 줄인다.
    prisma.receivableAdjustment.groupBy({
      by: ["userId"],
      _sum: { amount: true },
    }),
    // 사다드림 미수(별도 트랙) — 발행(ISSUED) 사다드림 계산서 지점별 합. 입금확인 시 PAID 로 빠짐.
    prisma.invoice.groupBy({
      by: ["userId"],
      where: { status: "ISSUED", kind: "SADADREAM" },
      _sum: { total: true },
      _count: true,
    }),
  ]);

  const balByUser = new Map(
    balances.map((b) => [b.userId, { sum: b._sum.total ?? 0, count: b._count }]),
  );
  const adjByUser = new Map(
    adjustments.map((a) => [a.userId, a._sum.amount ?? 0]),
  );
  const sdByUser = new Map(
    sdBalances.map((b) => [b.userId, b._sum.total ?? 0]),
  );
  const splitSet = new Set(splitReqs.map((s) => s.userId));

  const rows = stores
    .map((s) => ({
      id: s.id,
      storeName: s.storeName,
      payer: s.payerNames[0] ?? "미등록",
      // 미수 = 발행(ISSUED) + 조정(수동 + 입금매칭). receivableOf와 동일 기준(사다드림 제외).
      balance: (balByUser.get(s.id)?.sum ?? 0) + (adjByUser.get(s.id) ?? 0),
      count: balByUser.get(s.id)?.count ?? 0,
      sadadream: sdByUser.get(s.id) ?? 0, // 사다드림 미수(별도)
      split: splitSet.has(s.id),
    }))
    .sort(
      (a, b) => b.balance - a.balance || a.storeName.localeCompare(b.storeName),
    );

  const totalDue = rows.reduce((n, r) => n + r.balance, 0);
  const totalSadadream = rows.reduce((n, r) => n + r.sadadream, 0);

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

  // 전체 잠금해제 토글 상태(전역)
  const lockOverride = await orderLockOverride();

  return (
    <>
      <Topbar backHref="/admin" title="입금 관리" />
      <div className="page">
        <div className="deptotal">
          <span className="deptotal__k">전체 미수</span>
          <span
            className="deptotal__v"
            style={totalDue > 0 ? { color: "var(--danger)" } : undefined}
          >
            {fmt(totalDue)}원
          </span>
        </div>
        {totalSadadream > 0 && (
          <div className="deptotal" style={{ marginTop: -8 }}>
            <span className="deptotal__k">사다드림 미수</span>
            <span className="deptotal__v" style={{ color: "#2563eb" }}>
              {fmt(totalSadadream)}원
            </span>
          </div>
        )}

        {/* 지금 수집 — 팝빌 계좌조회에서 최근 입금을 즉시 끌어와 자동매칭(자동수집 크론과 별개, 수동 트리거) */}
        <CollectDepositsButton />

        {/* 전체 잠금해제 — ON이면 OFF할 때까지 모든 지점이 미수 있어도 일반/주간/예약 발주 가능 */}
        <div
          className={`card${lockOverride ? " card--flat" : ""}`}
          style={{
            marginBottom: 16,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            ...(lockOverride ? { background: "var(--green-100)", borderColor: "var(--green-700)" } : {}),
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 800 }}>전체 잠금해제</div>
          </div>
          <form action={setOrderLockOverrideAction} style={{ flexShrink: 0 }}>
            <input type="hidden" name="on" value={lockOverride ? "false" : "true"} />
            <button
              type="submit"
              role="switch"
              aria-checked={lockOverride}
              aria-label="전체 잠금해제"
              className={`switch ${lockOverride ? "is-on" : ""}`}
            >
              <span className="switch__knob" />
            </button>
          </form>
        </div>

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
                {r.sadadream > 0 && (
                  <div
                    style={{
                      color: "#2563eb",
                      fontWeight: 700,
                      fontSize: 12.5,
                      marginTop: 2,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    사다드림 {fmt(r.sadadream)}원
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>

        <div className="section-label">입출금내역</div>
        {txns.length === 0 ? (
          <div className="empty">
            <p>입출금 내역이 없어요.</p>
          </div>
        ) : (
          <div className="list">
            {txns.map((d) => {
              return (
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
                      amount={d.amount}
                      stores={storeOpts}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
