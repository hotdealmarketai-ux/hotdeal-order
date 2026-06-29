import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
} from "@/lib/deadline";
import { formatKDateTime } from "@/lib/format";
import { kstDayRange, labelDate, normalizeDateStr } from "@/lib/date";
import { ReceiptCard } from "@/components/ReceiptCard";

export default async function DayReceiptPage(props: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ new?: string; edited?: string }>;
}) {
  const user = await requireMerchant();
  const { date: rawDate } = await props.params;
  const { new: isNew, edited } = await props.searchParams;
  const date = normalizeDateStr(rawDate);
  const { start, end } = kstDayRange(date);

  const orders = await prisma.order.findMany({
    where: { userId: user.id, createdAt: { gte: start, lt: end } },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  if (orders.length === 0) notFound();

  const sorted = [...orders].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category as Category) -
      CATEGORY_ORDER.indexOf(b.category as Category),
  );
  const windowStart = currentWindowStartUtc();
  const canEditOrder = (createdAt: Date) =>
    !hasOrderWindow(user.role) ||
    (isOrderOpen() && createdAt.getTime() >= windowStart);

  return (
    <>
      <header className="topbar">
        <Link href="/mypage" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">{labelDate(date)} 발주서</div>
      </header>
      <div className="page">
        {isNew === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 발주가 접수되었어요. 아래 {sorted.length}개 종류로 발주되었어요.
          </div>
        )}
        {edited === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 발주가 수정되었어요.
          </div>
        )}

        {sorted.map((order) => {
          const cat = CATEGORIES[order.category as Category];
          return (
            <div key={order.id} style={{ marginBottom: 22 }}>
              <div className="spread" style={{ marginBottom: 8 }}>
                <span className="chip">{cat.label}</span>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {order.confirmed && (
                    <span className="badge badge--ok">확인됨 · 준비 중</span>
                  )}
                  {canEditOrder(order.createdAt) && (
                    <Link
                      href={`/order/${order.id}/edit`}
                      className="btn btn--xs btn--soft"
                    >
                      수정
                    </Link>
                  )}
                </div>
              </div>
              <ReceiptCard
                storeName={user.storeName}
                phone={user.phone}
                categoryLabel={cat.label}
                vendorLabel={cat.vendorLabel}
                dateText={formatKDateTime(order.createdAt)}
                pickupTime={order.pickupTime}
                aiSummary={order.aiSummary}
                aiEngine={order.aiEngine}
                items={order.items.map((it) => ({
                  name: it.name,
                  qty: it.qty,
                  note: it.note,
                }))}
                rawItems={order.items.map((it) => ({
                  rawName: it.rawName,
                  rawQty: it.rawQty,
                  rawNote: it.rawNote,
                }))}
                rawText={order.rawText}
                showPrintButton={false}
              />
            </div>
          );
        })}

        <div style={{ marginTop: 6 }}>
          <Link href="/order" className="btn btn--primary">
            새 발주하기
          </Link>
        </div>
      </div>
    </>
  );
}
