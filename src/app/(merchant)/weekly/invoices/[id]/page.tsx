import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canOrderWeekly, SAEROP_BANK_ACCOUNT, SAEROP_ACCOUNT_HOLDER } from "@/lib/constants";
import { labelDateLong } from "@/lib/date";
import { WeeklyReceipt } from "@/components/WeeklyReceipt";

const won = (n: number) => n.toLocaleString("ko-KR");
const STATUS: Record<string, { label: string; cls: string }> = {
  ISSUED: { label: "입금대기", cls: "badge--wait" },
  PAID: { label: "입금완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function WeeklyInvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireMerchant();
  if (!canOrderWeekly(user.role)) redirect("/order");
  const { id } = await params;

  const inv = await prisma.invoice.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!inv || inv.userId !== user.id || inv.kind !== "WEEKLY") notFound();

  const s = STATUS[inv.status] ?? STATUS.ISSUED;
  const receipt = inv.items.map((it) => ({
    category: it.category,
    name: it.name,
    sub: `${it.qty} × ${won(it.unitPrice)}`,
    amount: it.amount,
  }));

  return (
    <>
      <Topbar brand="핫딜오더" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
          <h1 className="h1" style={{ margin: 0 }}>
            주간발주 입금요청서
          </h1>
          <span className={`badge ${s.cls}`}>{s.label}</span>
        </div>
        <p className="lead">{labelDateLong(inv.date)} 주간발주</p>

        <WeeklyReceipt items={receipt} totalLabel="총 결제요청 금액" band />

        {inv.status === "ISSUED" && (
          <div className="card" style={{ marginTop: 16 }}>
            <div style={{ color: "var(--muted)", fontSize: 14 }}>입금하실 금액</div>
            <div style={{ fontWeight: 800, fontSize: 22, color: "var(--black)" }}>
              {won(inv.total)}원
            </div>
            <div style={{ marginTop: 8, fontSize: 14 }}>
              {SAEROP_BANK_ACCOUNT} 예금주 {SAEROP_ACCOUNT_HOLDER}
            </div>
          </div>
        )}

        <div style={{ marginTop: 20 }}>
          <Link href="/weekly/invoices" className="btn btn--ghost btn--block">
            목록으로
          </Link>
        </div>
      </div>
    </>
  );
}
