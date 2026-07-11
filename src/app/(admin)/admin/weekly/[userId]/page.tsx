import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { isMerchant, type Role } from "@/lib/constants";
import { labelDate } from "@/lib/date";
import {
  weeklyKeyAt,
  weeklyReceivableOf,
  isWeeklyUnlockActive,
} from "@/lib/weekly";
import { WeeklyInvoiceForm } from "@/components/WeeklyInvoiceForm";
import { ManualPayButton } from "@/components/ManualPayButton";
import { VoidWeeklyButton } from "@/components/VoidWeeklyButton";
import { setWeeklyOrderUnlockAction } from "@/app/actions/weekly-invoice";

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

  const unlockedThisWeek = isWeeklyUnlockActive(
    store.weeklyOrderUnlock,
    store.weeklyOrderUnlockAt,
  );

  const initialItems = (order?.items ?? []).map((it) => ({
    group: it.category,
    name: it.name,
    qty: String(it.qty),
    unitPrice: String(it.unitPrice),
  }));

  return (
    <>
      <Topbar brand="핫딜오더" title="주간발주 · 지점" />
      <div className="page">
        <h1 className="h1">{store.storeName}</h1>
        <p className="lead">{labelDate(weekKey)} 주간발주</p>

        {/* 주간 미수 + 잠금해제 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "var(--muted)" }}>
              주간 미수 · {receivable.count}건
            </span>
            <b style={{ color: "var(--black)" }}>{won(receivable.balance)}원</b>
          </div>
          <form
            action={setWeeklyOrderUnlockAction}
            style={{ marginTop: 10 }}
          >
            <input type="hidden" name="userId" value={userId} />
            <input type="hidden" name="unlock" value={unlockedThisWeek ? "false" : "true"} />
            <button className="btn btn--xs btn--soft" style={{ width: "100%" }}>
              {unlockedThisWeek ? "이번 주 잠금해제 취소" : "이번 주간발주 1회 잠금해제"}
            </button>
          </form>
        </div>

        {!order ? (
          <div className="notice notice--mute">이 지점의 이번 주 주간발주가 없어요.</div>
        ) : invoice ? (
          <>
            <div className="invcat">
              <div className="invcat__head">
                <span className="chip">입금요청서</span>
                <span
                  className={`badge ${invoice.status === "PAID" ? "badge--ok" : "badge--wait"}`}
                >
                  {invoice.status === "PAID" ? "입금완료" : "입금대기"}
                </span>
              </div>
              {invoice.items.map((it) => (
                <div className="invline" key={it.id}>
                  <span>
                    {it.name}
                    <span className="invline__meta">
                      {it.qty} × {won(it.unitPrice)}
                    </span>
                  </span>
                  <span className="invline__amt">{won(it.amount)}</span>
                </div>
              ))}
              <div className="invtotal" style={{ marginTop: 8 }}>
                <span>총 결제요청 금액</span>
                <b>{won(invoice.total)}원</b>
              </div>
            </div>
            {invoice.status === "ISSUED" && (
              <div style={{ marginTop: 12 }}>
                <ManualPayButton invoiceId={invoice.id} />
                <div style={{ marginTop: 10, textAlign: "center" }}>
                  <VoidWeeklyButton invoiceId={invoice.id} />
                </div>
              </div>
            )}
          </>
        ) : (
          <WeeklyInvoiceForm userId={userId} date={weekKey} initialItems={initialItems} />
        )}

        <div style={{ marginTop: 20 }}>
          <Link href={`/admin/weekly?week=${weekKey}`} className="btn btn--ghost btn--block">
            목록으로
          </Link>
        </div>
      </div>
    </>
  );
}
