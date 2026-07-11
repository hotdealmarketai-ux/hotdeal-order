import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { receiverLabel, needsPickupTime, type Category } from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
} from "@/lib/deadline";
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

  // 가맹점: 운영시간 + '이번 발주 창에 넣은 발주'만 수정 가능
  if (hasOrderWindow(user.role)) {
    const inWindow = order.createdAt.getTime() >= currentWindowStartUtc();
    if (!isOrderOpen() || !inWindow) redirect(backHref);
  }

  const initialItems = order.items.map((it) => ({
    name: it.rawName,
    qty: it.rawQty,
    note: it.rawNote,
  }));

  return (
    <>
      <Topbar backHref={backHref} title="발주 수정" />
      <div className="page">
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          저장하면 업체 화면에 &lsquo;발주 수정&rsquo;으로 표시돼요.
        </div>
        <EditOrderForm
          orderId={order.id}
          category={order.category as Category}
          receiver={receiverLabel(order.category as Category, user.role)}
          initialItems={initialItems}
          needsPickup={needsPickupTime(user.role)}
          initialPickup={order.pickupTime ?? ""}
        />
      </div>
    </>
  );
}
