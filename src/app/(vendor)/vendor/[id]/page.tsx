import Link from "next/link";
import { notFound } from "next/navigation";
import { requireVendor } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, type Category } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { ReceiptCard } from "@/components/ReceiptCard";
import { confirmOrderAction } from "@/app/actions/vendor";

export default async function VendorOrderDetail(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireVendor();
  const { id } = await props.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, user: true },
  });
  if (!order || order.vendorRole !== user.role) notFound();

  const cat = CATEGORIES[order.category as Category];

  return (
    <>
      <header className="topbar">
        <Link href="/vendor" className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">발주서</div>
      </header>
      <div className="page">
        {order.edited && !order.confirmed ? (
          <div className="notice notice--edit" style={{ marginBottom: 14 }}>
            발주수정 — 점주가 발주를 수정했어요. 내용 확인 후 다시 발주 확인을 눌러주세요.
          </div>
        ) : null}
        {order.confirmed ? (
          <div
            className="card card--flat"
            style={{
              marginBottom: 14,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span className="badge badge--ok">발주 확인됨</span>
            <form action={confirmOrderAction}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="next" value="false" />
              <button className="linkbtn">확인 취소</button>
            </form>
          </div>
        ) : (
          <form action={confirmOrderAction} style={{ marginBottom: 14 }}>
            <input type="hidden" name="orderId" value={order.id} />
            <input type="hidden" name="next" value="true" />
            <button className="btn btn--primary">발주 확인</button>
          </form>
        )}

        <div className="card card--flat" style={{ marginBottom: 14 }}>
          <div className="kv">
            <span className="kv__k">상호명</span>
            <span className="kv__v">{order.user.storeName}</span>
          </div>
          <div className="kv">
            <span className="kv__k">연락처</span>
            <span className="kv__v">{order.user.phone}</span>
          </div>
          <div className="kv">
            <span className="kv__k">소재지</span>
            <span className="kv__v">{order.user.address}</span>
          </div>
        </div>

        <ReceiptCard
          storeName={order.user.storeName}
          phone={order.user.phone}
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
        />
      </div>
    </>
  );
}
