import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { canOrderWeekly, SAEROP_BANK_ACCOUNT, SAEROP_ACCOUNT_HOLDER } from "@/lib/constants";
import { labelDate } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");
const STATUS: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: "입금대기", cls: "badge--wait" },
  PAID: { label: "입금완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function WeeklyInvoicesPage() {
  const user = await requireMerchant();
  if (!canOrderWeekly(user.role)) redirect("/order");

  const invoices = await prisma.invoice.findMany({
    where: { userId: user.id, kind: "WEEKLY", status: { not: "DRAFT" } },
    orderBy: { date: "desc" },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });

  const unpaid = invoices
    .filter((i) => i.status === "ISSUED")
    .reduce((n, i) => n + i.total, 0);

  return (
    <>
      <Topbar brand="핫딜오더" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <h1 className="h1">주간발주 입금요청서</h1>
        <p className="lead">
          출고일(수요일)에 발송돼요. 다음 주간발주(토요일 12시) 전까지 입금해 주세요.
        </p>

        {unpaid > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>입금하실 금액</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "var(--black)" }}>
              {won(unpaid)}원
            </div>
            <div style={{ marginTop: 8, fontSize: 14 }}>
              {SAEROP_BANK_ACCOUNT}
              <br />
              예금주 {SAEROP_ACCOUNT_HOLDER}
            </div>
          </div>
        )}

        {invoices.length === 0 ? (
          <div className="notice notice--mute">아직 받은 주간발주 입금요청서가 없어요.</div>
        ) : (
          <div className="list">
            {invoices.map((inv) => {
              const s = STATUS[inv.status] ?? STATUS.ISSUED;
              return (
                <div className="row" key={inv.id} style={{ cursor: "default" }}>
                  <div className="row__main">
                    <div className="row__title">
                      {labelDate(inv.date)} 주간발주 · {inv.items.length}품목
                    </div>
                    <div className="row__sub">{won(inv.total)}원</div>
                  </div>
                  <span className={`badge ${s.cls}`}>{s.label}</span>
                </div>
              );
            })}
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <Link href="/weekly" className="btn btn--ghost btn--block">
            주간발주로 돌아가기
          </Link>
        </div>
      </div>
    </>
  );
}
