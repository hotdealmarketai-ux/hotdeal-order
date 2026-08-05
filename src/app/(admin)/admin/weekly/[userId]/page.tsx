import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isMerchant, type Role } from "@/lib/constants";
import { labelDateLong } from "@/lib/date";
import {
  weeklyKeyAt,
  weeklyReceivableOf,
  weeklyStatusOf,
} from "@/lib/weekly";
import { WeeklyReceipt } from "@/components/WeeklyReceipt";
import { VoidWeeklyButton } from "@/components/VoidWeeklyButton";
import { DeleteWeeklyOrderButton } from "@/components/DeleteWeeklyOrderButton";
import { confirmWeeklyOrderAction } from "@/app/actions/weekly-invoice";

const won = (n: number) => n.toLocaleString("ko-KR");

export default async function AdminWeeklyStorePage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  await requireAdmin();
  const { userId } = await params;
  const sp = await searchParams;
  const weekKey = /^\d{4}-\d{2}-\d{2}$/.test(sp.week ?? "") ? sp.week! : weeklyKeyAt();

  const store = await prisma.user.findUnique({ where: { id: userId } });
  if (!store || !isMerchant(store.role as Role)) notFound();

  const [order, invoice, receivable] = await Promise.all([
    prisma.weeklyOrder.findUnique({
      where: { userId_weekKey: { userId, weekKey } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
    prisma.invoice.findFirst({
      where: { userId, kind: "WEEKLY", date: weekKey, status: { not: "VOID" } },
      include: { items: { orderBy: { sortOrder: "asc" } } },
    }),
    weeklyReceivableOf(userId),
  ]);

  const status = weeklyStatusOf(order, invoice);

  const orderReceipt = (order?.items ?? []).map((it) => ({
    category: it.category,
    name: it.name,
    sub: `${it.qty}박스 × ${won(it.unitPrice)}`,
    amount: it.qty * it.unitPrice,
  }));
  const invoiceReceipt = (invoice?.items ?? []).map((it) => ({
    category: it.category,
    name: it.name,
    sub: `${it.qty} × ${won(it.unitPrice)}`,
    amount: it.amount,
  }));

  return (
    <>
      <Topbar backHref={`/admin/weekly?week=${weekKey}`} title="주간발주 · 지점" />
      <div className="page">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <h1 className="h1" style={{ margin: 0 }}>
            {store.storeName}
          </h1>
          <span className={`badge ${status.cls}`}>{status.label}</span>
        </div>
        <p className="lead">{labelDateLong(weekKey)} 주간발주</p>

        {/* 주간발주 미수(표시만) — 1회 잠금해제는 입금 관리로 통합(일반·주간 함께 해제) */}
        {receivable.balance > 0 && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ color: "var(--muted)" }}>주간발주 미수금액</span>
              <b style={{ color: "var(--black)" }}>{won(receivable.balance)}원</b>
            </div>
          </div>
        )}

        {!order ? (
          <div className="notice notice--mute">이 지점의 주간발주가 없습니다.</div>
        ) : invoice ? (
          <>
            <div className="invcat" style={{ marginBottom: 4 }}>
              <div className="invcat__head">
                <span className="chip">입금요청서</span>
                <span className={`badge ${status.cls}`}>{status.label}</span>
              </div>
            </div>
            <WeeklyReceipt items={invoiceReceipt} totalLabel="총 결제요청 금액" band />
            {invoice.status === "ISSUED" && (
              <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
                <VoidWeeklyButton invoiceId={invoice.id} />
              </div>
            )}
          </>
        ) : !order.confirmed ? (
          <>
            <WeeklyReceipt items={orderReceipt} totalLabel="예상 금액" />
            <div style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
              <form action={confirmWeeklyOrderAction}>
                <input type="hidden" name="orderId" value={order.id} />
                <button className="btn btn--primary btn--block">발주 확인</button>
              </form>
            </div>
          </>
        ) : (
          <>
            <WeeklyReceipt items={orderReceipt} totalLabel="확인된 주간발주 금액" />
            <div className="notice notice--ai" style={{ marginTop: 14 }}>
              이 주간발주는 <b>출고일 계산서에 합산</b>해 청구됩니다.
            </div>
          </>
        )}
        {order && (
          <div style={{ marginTop: 14 }}>
            <DeleteWeeklyOrderButton orderId={order.id} />
          </div>
        )}
      </div>
    </>
  );
}
