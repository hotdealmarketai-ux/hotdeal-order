import Link from "next/link";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { ReceiptCard } from "@/components/ReceiptCard";

export default async function ReceiptPage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ new?: string }>;
}) {
  const user = await requireMerchant();
  const { id } = await props.params;
  const { new: isNew } = await props.searchParams;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!order || order.userId !== user.id) notFound();

  const cat = CATEGORIES[order.category as Category];

  return (
    <>
      <header className="topbar">
        <Link href="/order" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">발주서</div>
      </header>
      <div className="page">
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
        />
        <div style={{ marginTop: 18 }}>
          <Link href="/order" className="btn btn--primary">
            새 발주하기
          </Link>
        </div>
      </div>
    </>
  );
}
