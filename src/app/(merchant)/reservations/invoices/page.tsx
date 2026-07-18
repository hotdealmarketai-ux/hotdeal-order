import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SAEROP_BANK_ACCOUNT, SAEROP_ACCOUNT_HOLDER } from "@/lib/constants";
import { labelDateLong } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");
const STATUS: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: "입금대기", cls: "badge--wait" },
  PAID: { label: "입금완료", cls: "badge--ok" },
};

export default async function ReservationInvoicesPage() {
  const user = await requireMerchant();
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");

  const invoices = await prisma.invoice.findMany({
    where: { userId: user.id, kind: "RESERVATION", status: { not: "DRAFT" } },
    orderBy: { date: "desc" },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  const unpaid = invoices
    .filter((i) => i.status === "ISSUED")
    .reduce((n, i) => n + i.total, 0);

  return (
    <>
      <Topbar backHref="/reservations" title="예약발주 입금요청서" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        {unpaid > 0 && (
          <div className="payband" style={{ marginBottom: 16, marginTop: 0 }}>
            <div className="payband__label">입금하실 금액</div>
            <div className="payband__amt">{won(unpaid)}원</div>
            <div className="payband__acct">
              {SAEROP_BANK_ACCOUNT} 예금주 {SAEROP_ACCOUNT_HOLDER}
            </div>
          </div>
        )}

        {invoices.length === 0 ? (
          <div className="notice notice--mute">아직 받은 예약발주 입금요청서가 없어요.</div>
        ) : (
          <div className="list">
            {invoices.map((inv) => {
              const s = STATUS[inv.status] ?? STATUS.ISSUED;
              return (
                <Link href={`/reservations/invoices/${inv.id}`} className="row" key={inv.id}>
                  <div className="row__main">
                    <div className="row__title">
                      {labelDateLong(inv.date)} 픽업 · {inv.items.length}개
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
