import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isMerchant, type Role } from "@/lib/constants";
import { labelDateLong } from "@/lib/date";
import {
  weeklyKeyAt,
  weeklyReceivableOf,
  isWeeklyUnlockActive,
  weeklyStatusOf,
  getWeeklyProducts,
} from "@/lib/weekly";
import { WeeklyInvoiceForm } from "@/components/WeeklyInvoiceForm";
import { WeeklyReceipt } from "@/components/WeeklyReceipt";
import { ManualPayButton } from "@/components/ManualPayButton";
import { VoidWeeklyButton } from "@/components/VoidWeeklyButton";
import {
  setWeeklyOrderUnlockAction,
  confirmWeeklyOrderAction,
} from "@/app/actions/weekly-invoice";

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
  const products = order && order.confirmed && !invoice ? await getWeeklyProducts() : [];

  const unlockedThisWeek = isWeeklyUnlockActive(
    store.weeklyOrderUnlock,
    store.weeklyOrderUnlockAt,
  );
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
  const initialItems = (order?.items ?? []).map((it) => ({
    group: it.category,
    name: it.name,
    qty: String(it.qty),
    unitPrice: String(it.unitPrice),
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

        {/* 주간발주 미수 + 잠금해제 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--muted)" }}>주간발주 미수금액</span>
            <b style={{ color: "var(--black)" }}>{won(receivable.balance)}원</b>
          </div>
          <form action={setWeeklyOrderUnlockAction} style={{ marginTop: 10 }}>
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="unlock" value={unlockedThisWeek ? "false" : "true"} />
            <button className="btn btn--soft btn--block">
              {unlockedThisWeek ? "잠금해제 취소" : "주간발주 1회 잠금해제"}
            </button>
          </form>
        </div>

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
                <ManualPayButton invoiceId={invoice.id} block />
                <VoidWeeklyButton invoiceId={invoice.id} />
                <Link href={`/admin/weekly?week=${weekKey}`} className="btn btn--ghost btn--block">
                  목록으로
                </Link>
              </div>
            )}
            {invoice.status !== "ISSUED" && (
              <div style={{ marginTop: 14 }}>
                <Link href={`/admin/weekly?week=${weekKey}`} className="btn btn--ghost btn--block">
                  목록으로
                </Link>
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
              <Link href={`/admin/weekly?week=${weekKey}`} className="btn btn--ghost btn--block">
                목록으로
              </Link>
            </div>
          </>
        ) : (
          <>
            <WeeklyInvoiceForm
              userId={userId}
              date={weekKey}
              initialItems={initialItems}
              products={products}
            />
            <div style={{ marginTop: 14 }}>
              <Link href={`/admin/weekly?week=${weekKey}`} className="btn btn--ghost btn--block">
                목록으로
              </Link>
            </div>
          </>
        )}
      </div>
    </>
  );
}
