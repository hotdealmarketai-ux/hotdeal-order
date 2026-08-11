import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { labelDate } from "@/lib/date";
import { receivableOf, receivableSadadreamOf } from "@/lib/receivable";
import { BillingLauncher } from "@/components/BillingLauncher";

const won = (n: number) => n.toLocaleString("ko-KR");
const KIND: Record<string, string> = { DAILY: "발주", WEEKLY: "주간발주", REFUND: "환불계산서", SADADREAM: "사다드림" };
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

  const [rec, invoices, sdRec] = await Promise.all([
    // 미수 = 발행분 + 관리자 수동조정(입금관리·점주 화면과 동일 기준). ISSUED만 합치면 수동조정이 빠져 안 맞음.
    receivableOf(id),
    prisma.invoice.findMany({
      where: { userId: id, status: { not: "VOID" } },
      // 출고일(date) 최신순 고정 — updatedAt은 수정/입금확인/재차감마다 바뀌어 순서가 뒤틀림(같은날은 생성순).
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 200,
      select: { id: true, date: true, kind: true, status: true, total: true },
    }),
    receivableSadadreamOf(id), // 사다드림 미수(별도 트랙)
  ]);
  const bal = rec.balance;
  const sdBal = sdRec.balance;

  return (
    <>
      <Topbar backHref="/admin/billing" title={merchant.storeName} />
      <div className="page">
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="row__sub">미수 (발행 후 미입금)</div>
          <div style={{ fontSize: 24, fontWeight: 800, marginTop: 4, color: bal > 0 ? "var(--danger)" : "var(--green-700)" }}>
            {won(bal)}원
          </div>
          {sdBal > 0 && (
            <div className="spread" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
              <span className="row__sub">사다드림 미수</span>
              <b style={{ color: "#2563eb", fontVariantNumeric: "tabular-nums" }}>{won(sdBal)}원</b>
            </div>
          )}
        </div>

        <div className="itemshead">
          <span className="itemshead__label">계산서 발행</span>
        </div>
        <BillingLauncher userId={merchant.id} />

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
              const isDraft = inv.status === "DRAFT";
              const isRefund = inv.kind === "REFUND";
              return (
                <Link
                  href={`/admin/invoices/${inv.id}`}
                  className={`row${isDraft ? " row--draft" : isRefund ? " row--refund" : ""}`}
                  key={inv.id}
                >
                  <div className="row__main">
                    <div className="row__title">
                      {labelDate(inv.date)} · {KIND[inv.kind] ?? inv.kind}
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
                    <span className={`badge ${isDraft ? "badge--onbrand" : s.cls}`}>
                      {s.label}
                    </span>
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
