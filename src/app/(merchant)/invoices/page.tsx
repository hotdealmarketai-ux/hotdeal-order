import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SAEROP_BANK_ACCOUNT, SAEROP_ACCOUNT_HOLDER } from "@/lib/constants";
import { receivableOf, receivableSadadreamOf } from "@/lib/receivable";
import { labelDate } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");
const KIND: Record<string, string> = {
  DAILY: "일반발주",
  WEEKLY: "주간발주",
  REFUND: "환불계산서",
  SADADREAM: "사다드림 계산서",
};
const STATUS: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: "입금대기", cls: "badge--wait" },
  PAID: { label: "입금완료", cls: "badge--ok" },
};

// 점주 통합 입금요청서 — 내 앞으로 발행된 모든 계산서(일반+주간) + 총 미수. 유일한 계산서 조회 페이지.
export default async function MerchantInvoicesPage() {
  const user = await requireMerchant();
  const invoices = await prisma.invoice.findMany({
    where: { userId: user.id, status: { in: ["ISSUED", "PAID"] } },
    orderBy: [{ issuedAt: "desc" }, { date: "desc" }],
    select: { id: true, date: true, kind: true, status: true, total: true },
  });
  // 미수(입금하실 금액)는 마이·발주 화면과 동일하게 receivableOf(계산서 합 + 관리자 수동 조정)로 계산 —
  // 조정을 무시한 계산서 합만 쓰면 여기 표시액이 마이페이지와 달라진다.
  const unpaid = (await receivableOf(user.id)).balance;
  // 사다드림 미수(별도 트랙) — 우리 계좌가 아닌 개인/개인업체 계좌로 결제. 전체 미수와 분리.
  const sdUnpaid = (await receivableSadadreamOf(user.id)).balance;
  // 낱장 계산서의 결제 여부는 매칭이 지점 단위라 알 수 없다(입금확인 폐지, 2026-08-05). 배지는 '지점 총미수'로만 판단:
  // 미수가 0 이하면 전부 '입금완료', 남아 있으면 전부 '입금대기'. (낱장 추정 = 이중납부 위험이라 하지 않는다)
  // ※ 사다드림은 예외 — 낱장 단위로 입금확인(PAID)하므로 그 계산서 status 를 그대로 쓴다.
  const storePaid = unpaid <= 0;

  return (
    <>
      <Topbar backHref="/mypage" title="입금요청서" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        {unpaid > 0 && (
          <div className="payband" style={{ marginBottom: 16, marginTop: 0 }}>
            <div className="payband__label">입금하실 금액 (미수)</div>
            <div className="payband__amt">{won(unpaid)}원</div>
            <div className="payband__acct">
              {SAEROP_BANK_ACCOUNT} 예금주 {SAEROP_ACCOUNT_HOLDER}
            </div>
          </div>
        )}

        {sdUnpaid > 0 && (
          <div
            className="card"
            style={{ marginBottom: 16, borderColor: "#2563eb" }}
          >
            <div className="spread">
              <span className="row__sub" style={{ color: "#2563eb", fontWeight: 700 }}>
                사다드림 미수
              </span>
              <b style={{ fontSize: 18, color: "#2563eb", fontVariantNumeric: "tabular-nums" }}>
                {won(sdUnpaid)}원
              </b>
            </div>
            <div className="row__sub" style={{ marginTop: 4 }}>
              각 사다드림 계산서에 적힌 입금계좌로 결제해 주세요.
            </div>
          </div>
        )}

        {invoices.length === 0 ? (
          <div className="notice notice--mute">아직 받은 입금요청서가 없습니다.</div>
        ) : (
          <div className="list">
            {invoices.map((inv) => {
              const isRefund = inv.kind === "REFUND";
              const isSd = inv.kind === "SADADREAM";
              // 사다드림은 낱장 상태(입금확인 PAID)를 그대로, 나머지는 지점 총미수로 판정.
              const s = isSd
                ? STATUS[inv.status] ?? STATUS.ISSUED
                : storePaid
                  ? STATUS.PAID
                  : STATUS.ISSUED;
              return (
                <Link
                  href={`/invoices/${inv.id}`}
                  className={`row${isRefund ? " row--refund" : ""}`}
                  key={inv.id}
                >
                  <div className="row__main">
                    <div className="row__title">
                      {labelDate(inv.date)} · {KIND[inv.kind] ?? "계산서"}
                    </div>
                    <div className="row__sub">
                      {isRefund
                        ? `− ${won(Math.abs(inv.total))}원 (미수 차감)`
                        : `${won(inv.total)}원`}
                    </div>
                  </div>
                  {isRefund ? (
                    <span className="badge badge--refund">환불</span>
                  ) : (
                    <span className={`badge ${s.cls}`}>{s.label}</span>
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
