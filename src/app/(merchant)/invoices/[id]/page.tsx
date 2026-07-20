import { notFound } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { SAEROP_BANK_ACCOUNT, SAEROP_ACCOUNT_HOLDER } from "@/lib/constants";
import { labelDateLong } from "@/lib/date";
import { WeeklyReceipt } from "@/components/WeeklyReceipt";
import { PrintButton } from "@/components/PrintButton";

const won = (n: number) => n.toLocaleString("ko-KR");
const KIND: Record<string, string> = { DAILY: "일반발주", WEEKLY: "주간발주" };
const STATUS: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: "입금대기", cls: "badge--wait" },
  PAID: { label: "입금완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function MerchantInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireMerchant();
  const { id } = await params;

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!inv || inv.userId !== user.id || inv.status === "DRAFT") notFound();

  const s = STATUS[inv.status] ?? STATUS.ISSUED;
  const receipt = inv.items.map((it) => ({
    category: it.category,
    name: it.name,
    sub: `${it.qty} × ${won(it.unitPrice)}`,
    amount: it.amount,
  }));

  return (
    <>
      <Topbar backHref="/invoices" title="입금요청서" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 className="h1" style={{ margin: 0 }}>
            입금요청서
          </h1>
          <span className={`badge ${s.cls}`}>{s.label}</span>
        </div>
        <p className="lead">
          {labelDateLong(inv.date)} · {KIND[inv.kind] ?? "계산서"}
        </p>

        <WeeklyReceipt items={receipt} totalLabel="총 결제요청 금액" />

        {inv.status === "ISSUED" && (
          <div className="payband">
            <div className="payband__label">입금하실 금액</div>
            <div className="payband__amt">{won(inv.total)}원</div>
            <div className="payband__acct">
              {SAEROP_BANK_ACCOUNT} 예금주 {SAEROP_ACCOUNT_HOLDER}
            </div>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <PrintButton label="계산서 인쇄" />
        </div>
      </div>
    </>
  );
}
