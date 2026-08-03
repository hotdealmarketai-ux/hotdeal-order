import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { kstToday } from "@/lib/date";
import { RefundInvoiceForm } from "@/components/RefundInvoiceForm";

// 환불계산서 작성 — 계산서 발행 상세의 '환불계산서 발행'(빨강) 버튼에서 진입.
export default async function RefundInvoicePage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const merchant = await prisma.user.findUnique({
    where: { id },
    select: { id: true, storeName: true, role: true },
  });
  if (!merchant || merchant.role !== "MERCHANT_HOTDEAL") notFound();

  return (
    <>
      <Topbar backHref={`/admin/billing/${merchant.id}`} title="환불계산서 발행" />
      <div className="page">
        <RefundInvoiceForm
          userId={merchant.id}
          storeName={merchant.storeName}
          defaultDate={kstToday()}
        />
      </div>
    </>
  );
}
