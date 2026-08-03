import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SAEROP_BANK_ACCOUNT, SAEROP_ACCOUNT_HOLDER } from "@/lib/constants";
import { receivableOf } from "@/lib/receivable";
import { labelDate } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");
const KIND: Record<string, string> = { DAILY: "일반발주", WEEKLY: "주간발주" };
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

        {invoices.length === 0 ? (
          <div className="notice notice--mute">아직 받은 입금요청서가 없습니다.</div>
        ) : (
          <div className="list">
            {invoices.map((inv) => {
              const s = STATUS[inv.status] ?? STATUS.ISSUED;
              return (
                <Link href={`/invoices/${inv.id}`} className="row" key={inv.id}>
                  <div className="row__main">
                    <div className="row__title">
                      {labelDate(inv.date)} · {KIND[inv.kind] ?? "계산서"}
                    </div>
                    <div className="row__sub">{won(inv.total)}원</div>
                  </div>
                  <span className={`badge ${s.cls}`}>{s.label}</span>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
