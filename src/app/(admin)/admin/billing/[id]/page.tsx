import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { canOrderWeekly, type Role } from "@/lib/constants";
import { labelDate } from "@/lib/date";
import { BillingLauncher } from "@/components/BillingLauncher";

const won = (n: number) => n.toLocaleString("ko-KR");
const KIND: Record<string, string> = { DAILY: "일반발주", WEEKLY: "주간발주" };
const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: "작성중", cls: "badge--mute" },
  ISSUED: { label: "입금대기", cls: "badge--wait" },
  PAID: { label: "입금완료", cls: "badge--ok" },
  VOID: { label: "취소됨", cls: "badge--mute" },
};

export default async function AdminBillingMerchantPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const merchant = await prisma.user.findUnique({
    where: { id },
    select: { id: true, storeName: true, role: true },
  });
  if (!merchant || merchant.role !== "MERCHANT_HOTDEAL") notFound();

  const [ar, invoices] = await Promise.all([
    prisma.invoice.aggregate({
      where: { userId: id, status: "ISSUED" },
      _sum: { total: true },
    }),
    prisma.invoice.findMany({
      where: { userId: id, status: { not: "VOID" } },
      orderBy: { updatedAt: "desc" },
      take: 200,
      select: { id: true, date: true, kind: true, status: true, total: true },
    }),
  ]);
  const bal = ar._sum.total ?? 0;

  return (
    <>
      <Topbar backHref="/admin/billing" title={merchant.storeName} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">미수 (발행 후 미입금)</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: bal > 0 ? "var(--danger)" : "var(--green-700)" }}>
            {won(bal)}원
          </div>
        </div>

        <div className="itemshead">
          <span className="itemshead__label">계산서 발행</span>
        </div>
        <BillingLauncher userId={merchant.id} canWeekly={canOrderWeekly(merchant.role as Role)} />

        <div className="itemshead" style={{ marginTop: 24 }}>
          <span className="itemshead__label">발행된 계산서</span>
          <span className="itemshead__count">{invoices.length}건</span>
        </div>
        {invoices.length === 0 ? (
          <div className="empty">아직 발행한 계산서가 없어요.</div>
        ) : (
          <div className="list">
            {invoices.map((inv) => {
              const s = STATUS[inv.status] ?? STATUS.ISSUED;
              return (
                <Link href={`/admin/invoices/${inv.id}`} className="row" key={inv.id}>
                  <div className="row__main">
                    <div className="row__title">
                      {labelDate(inv.date)} · {KIND[inv.kind] ?? inv.kind}
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
