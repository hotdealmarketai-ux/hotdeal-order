import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { kstDateOf, kstToday } from "@/lib/date";
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
  const isPastDay = kstDateOf(order.createdAt) < kstToday();

  return (
    <>
      <Topbar backHref="/order" title="발주서" />
      <div className="page">
        {edited === "1" && (
          <div className="notice notice--ai" style={{ marginBottom: 14 }}>
            ✓ 발주가 수정되었어요.
          </div>
        )}

        {isPastDay ? (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            발주가 완료되었습니다.
          </div>
        ) : order.confirmed ? (
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
        />
      </div>
    </>
  );
}
