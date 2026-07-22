import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, ROLE_LABEL, type Category, type Role } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { ReceiptCard } from "@/components/ReceiptCard";

export default async function AdminOrderDetail(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, user: true },
  });
  if (!order) notFound();

  const cat = CATEGORIES[order.category as Category];

  return (
    <>
      <Topbar backHref="/admin/orders" title="발주서" />
      <div className="page">
        {order.status === "CANCELLED" && (
          <div className="notice notice--error" style={{ marginBottom: 14 }}>
            <b>취소 완료</b> · 발주가 취소되었습니다.
          </div>
        )}
        <div className="card card--flat" style={{ marginBottom: 14 }}>
          <div className="kv">
            <span className="kv__k">상호명</span>
            <span className="kv__v">{order.user.storeName}</span>
          </div>
          <div className="kv">
            <span className="kv__k">유형</span>
            <span className="kv__v">{ROLE_LABEL[order.user.role as Role]}</span>
          </div>
          <div className="kv">
            <span className="kv__k">연락처</span>
            <span className="kv__v">{order.user.phone}</span>
          </div>
          <div className="kv">
            <span className="kv__k">보내는 곳</span>
            <span className="kv__v">{cat.vendorLabel}</span>
          </div>
        </div>

        <ReceiptCard
          storeName={order.user.storeName}
          phone={order.user.phone}
          categoryLabel={cat.label}
          vendorLabel={cat.vendorLabel}
          dateText={formatKDateTime(order.createdAt)}
          pickupTime={order.pickupTime}
          fulfillment={order.fulfillment}
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
        />
      </div>
    </>
  );
}
