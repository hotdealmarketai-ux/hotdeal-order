import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER } from "@/lib/constants";
import { labelDate, labelDateLong } from "@/lib/date";
import { formatKDateTime } from "@/lib/format";
import { WeeklyReceipt } from "@/components/WeeklyReceipt";
import { RefundReceipt } from "@/components/RefundReceipt";
import { PrintButton } from "@/components/PrintButton";
import { InvoiceRevisionHistory } from "@/components/InvoiceRevisionHistory";
import { parseRevisionChanges } from "@/lib/invoice-revision";

const won = (n: number) => n.toLocaleString("ko-KR");
const KIND: Record<string, string> = { DAILY: "일반발주", WEEKLY: "주간발주" };

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

  // 환불계산서 — 입금요청서와 달리 '입금하실 금액' 없이 환불 내역만. 미수에서 차감됨.
  if (inv.kind === "REFUND") {
    const refundItems = inv.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      unitPrice: it.unitPrice,
      amount: it.amount,
    }));
    const refundRevisions = (
      await prisma.invoiceRevision.findMany({
        where: { invoiceId: id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          createdAt: true,
          totalBefore: true,
          totalAfter: true,
          changes: true,
        },
      })
    ).map((r) => ({ ...r, changes: parseRevisionChanges(r.changes) }));
    return (
      <>
        <Topbar backHref="/invoices" title="환불계산서" right={<TopbarChip>{user.storeName}</TopbarChip>} />
        <div className="page">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <h1 className="h1" style={{ margin: 0 }}>
              환불계산서
            </h1>
            <span className="badge badge--refund">환불</span>
          </div>
          {inv.revisedAt && inv.status !== "VOID" && (
            <div className="notice notice--ai" style={{ margin: "10px 0" }}>
              이 환불계산서는 {formatKDateTime(inv.revisedAt)}에 수정되었어요. 아래 내용이 최신이에요.
            </div>
          )}
          <RefundReceipt
            storeName={user.storeName}
            dateLabel={labelDate(inv.date)}
            items={refundItems}
            note={
              inv.status === "VOID"
                ? "취소된 환불계산서입니다."
                : "이 금액만큼 미수(입금하실 금액)에서 차감되었습니다."
            }
          />
          <InvoiceRevisionHistory revisions={refundRevisions} isRefund />
          <div style={{ marginTop: 16 }}>
            <PrintButton label="환불계산서 인쇄" />
          </div>
        </div>
      </>
    );
  }

  // 수정 내역(재발송 시점별) — 최신순.
  const revisions = (
    await prisma.invoiceRevision.findMany({
      where: { invoiceId: id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        totalBefore: true,
        totalAfter: true,
        changes: true,
      },
    })
  ).map((r) => ({ ...r, changes: parseRevisionChanges(r.changes) }));

  const receipt = inv.items.map((it) => ({
    category: it.category,
    name: it.name,
    // 주간발주 합산분은 박스/판 단위 그대로 표시(예: "3박스 × 20,000"). 용달 발송은 수량·단가 표기 없이 금액만.
    sub:
      it.category === "DELIVERY"
        ? ""
        : it.category === "WEEKLY" && it.unit
        ? `${it.qty}${it.unit} × ${won(it.unitPrice)}`
        : `${it.qty} × ${won(it.unitPrice)}`,
    amount: it.amount,
  }));
  // 일반발주 계산서는 용달 발송/과일/야채/공구/채움채(+주간발주 합산분)로 분류(안 넘기면 전부 '기타'로 나옴). 주간은 기본값.
  const invCats =
    inv.kind === "DAILY"
      ? [
          { key: "DELIVERY", label: "용달 발송" },
          ...CATEGORY_ORDER.map((c) => ({ key: c, label: CATEGORIES[c].label })),
          { key: "WEEKLY", label: "주간발주" },
        ]
      : undefined;

  return (
    <>
      <Topbar backHref="/invoices" title="입금요청서" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <h1 className="h1" style={{ margin: 0 }}>
          입금요청서
        </h1>
        <p className="lead">
          {labelDateLong(inv.date)} · {KIND[inv.kind] ?? "계산서"}
        </p>
        {inv.revisedAt && (
          <div className="notice notice--ai" style={{ marginBottom: 12 }}>
            이 계산서는 {formatKDateTime(inv.revisedAt)}에 수정되었어요. 아래 내용을
            다시 확인해 주세요.
          </div>
        )}

        <WeeklyReceipt items={receipt} totalLabel="총 결제요청 금액" cats={invCats} />

        {/* 이 계산서는 '내역(영수증)'만 보여준다. 입금하실 금액·계좌는 지점 전체 미수 기준이라 입금요청서에서 확인
            (계산서 낱장 결제 여부는 매칭이 지점 단위라 알 수 없어, 낱장에 '입금하세요'를 띄우면 이중납부 위험). */}
        <Link href="/invoices" className="btn btn--soft" style={{ marginTop: 12 }}>
          입금하실 금액(지점 미수)은 입금요청서에서 확인
        </Link>

        <InvoiceRevisionHistory revisions={revisions} />

        <div style={{ marginTop: 16 }}>
          <PrintButton label="계산서 인쇄" />
        </div>
      </div>
    </>
  );
}
