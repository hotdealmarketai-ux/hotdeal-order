import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { CATEGORIES, needsPickupTime, type Category } from "@/lib/constants";
import { hasOrderWindow, isOrderOpen } from "@/lib/deadline";
import { kstDateOf } from "@/lib/date";
import { EditOrderForm } from "@/components/EditOrderForm";

export default async function EditOrderPage(props: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireMerchant();
  const { id } = await props.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } } },
  });
  if (!order || order.userId !== user.id) notFound();

  const orderDate = kstDateOf(order.createdAt);
  const backHref = hasOrderWindow(user.role)
    ? `/order/day/${orderDate}`
    : `/order/${order.id}`;

  // 가맹점은 운영시간(12~20시)에만 수정 가능
  if (hasOrderWindow(user.role) && !isOrderOpen()) redirect(backHref);

  const cat = CATEGORIES[order.category as Category];
  const initialItems = order.items.map((it) => ({
    name: it.rawName,
    qty: it.rawQty,
    note: it.rawNote,
  }));

  return (
    <>
      <header className="topbar">
        <Link href={backHref} className="topbar__back" aria-label="뒤로">
          ‹
        </Link>
        <div className="topbar__title">발주 수정</div>
      </header>
      <div className="page">
        <h1 className="h1">발주 수정</h1>
        <div className="notice notice--info" style={{ marginBottom: 14 }}>
          받는 곳 · <b>{cat.vendorLabel}</b>
        </div>
        <EditOrderForm
          orderId={order.id}
          initialItems={initialItems}
          needsPickup={needsPickupTime(user.role)}
          initialPickup={order.pickupTime ?? ""}
        />
      </div>
    </>
  );
}
