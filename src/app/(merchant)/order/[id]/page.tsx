import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, type Category } from "@/lib/constants";
import { hasOrderWindow, isOrderOpen } from "@/lib/deadline";
import { formatKDateTime } from "@/lib/format";
import { ReceiptCard } from "@/components/ReceiptCard";

export default async function ReceiptPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string; edited?: string }>;
}) {
  const user = await requireMerchant();
  const { id } = await props.params;
  const { new: isNew, edited } = await props.searchParams;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!order || order.userId !== user.id) notFound();

  const cat = CATEGORIES[order.category as Category];
  const canEdit = !hasOrderWindow(user.role) || isOrderOpen();

  return (
    <>
      <header className="topbar">
        <Link href="/order" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">발주서</div>
      </header>
      <div className="page">
        {edited === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 발주가 수정되었어요.
          </div>
        )}

        {order.confirmed ? (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            발주가 확인되었습니다. 준비 중이에요.
          </div>
        ) : null}

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
          isNew={isNew === "1"}
          showPrintButton={false}
        />

        <div className="confirm__actions" style={{ marginTop: 18 }}>
          {canEdit && (
            <Link href={`/order/${order.id}/edit`} className="btn btn--ghost">
              발주 수정
            </Link>
          )}
          <Link href="/order" className="btn btn--primary">
            새 발주하기
          </Link>
        </div>
      </div>
    </>
  );
}
