import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, ROLE_LABEL, type Category, type Role } from "@/lib/constants";
import { formatKDateTime } from "@/lib/format";
import { kstDateOf } from "@/lib/date";
import { ReceiptCard } from "@/components/ReceiptCard";

export default async function AdminOrderDetail(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ edited?: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;
  const { edited } = await props.searchParams;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, user: true },
  });
  if (!order) notFound();

  const cat = CATEGORIES[order.category as Category];

  // 관리자 수정 가능 여부 — 취소분·계산서 발행분은 잠금(정합)
  const issuedInv =
    order.status === "CANCELLED"
      ? null
      : await prisma.invoice.findFirst({
          where: {
            userId: order.userId,
            kind: "DAILY",
            date: kstDateOf(order.createdAt),
            status: { in: ["ISSUED", "PAID"] },
          },
          select: { id: true },
        });
  const canEdit = order.status !== "CANCELLED" && !issuedInv;

  return (
    <>
      <Topbar backHref="/admin/orders" title="발주서" />
      <div className="page">
        {edited === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 14 }}>
            ✓ 발주가 수정되었어요. 점주와 받는 업체에 알림을 보냈어요.
          </div>
        )}
        {order.status === "CANCELLED" && (
          <div className="notice notice--error" style={{ marginBottom: 14 }}>
            <b>취소 완료</b> · 발주가 취소되었습니다.
          </div>
        )}
        {!canEdit && order.status !== "CANCELLED" && (
          <div className="notice notice--mute" style={{ marginBottom: 14 }}>
            입금요청서가 발행된 발주라 수정이 잠겨 있어요. 계산서를 수정해 주세요.
          </div>
        )}
        {canEdit && (
          <div className="spread" style={{ marginBottom: 14 }}>
            <span className="muted" style={{ fontSize: 13 }}>
              발주 내용을 고칠 수 있어요.
            </span>
            <Link
              href={`/admin/orders/${order.id}/edit`}
              className="btn btn--sm btn--primary"
            >
              발주 수정
            </Link>
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
