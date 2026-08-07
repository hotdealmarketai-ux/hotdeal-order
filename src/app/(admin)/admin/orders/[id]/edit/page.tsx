import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  receiverLabel,
  needsPickupTime,
  needsFulfillment,
  ROLE_LABEL,
  type Category,
  type Fulfillment,
  type Role,
} from "@/lib/constants";
import { kstDateOf, shipmentDayOf } from "@/lib/date";
import { heldByItem } from "@/lib/stock-hold";
import { windowKeyAt } from "@/lib/schedule";
import { EditOrderForm } from "@/components/EditOrderForm";

// 관리자(새롭) 발주 수정 — 아무 지점 발주나. 발주창 제한 없음.
// 취소분·계산서 발행분은 진입 차단(정합). 저장 시 점주+업체에 '발주 수정' 알림.
export default async function AdminEditOrderPage(props: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await props.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: { orderBy: { sortOrder: "asc" } }, user: true },
  });
  if (!order) notFound();

  const backHref = `/admin/orders/${order.id}`;

  // 취소분은 수정 불가
  if (order.status === "CANCELLED") redirect(backHref);

  // 계산서(입금요청서) 발행분은 잠금 — 발행 후 변경은 계산서 수정으로
  // Invoice.date = 출고일 기준 → 발주의 출고일로 매칭(발주일로 찾으면 하루 어긋나 오작동)
  const issuedInv = await prisma.invoice.findFirst({
    where: {
      userId: order.userId,
      kind: "DAILY",
      date: shipmentDayOf(kstDateOf(order.createdAt)),
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  if (issuedInv) redirect(backHref);

  const ownerRole = order.user.role as Role;
  const initialItems = order.items.map((it) => ({
    name: it.rawName,
    qty: it.rawQty,
    note: it.rawNote,
  }));

  // 공구(TOOL) 수정 — 재고 검색 팝업용 재고현황 품목(남은 재고 = base − Σ담기홀드).
  let invOptions: { id: string; name: string; available: number }[] = [];
  if (order.category === "TOOL") {
    const [invItems, held] = await Promise.all([
      prisma.inventoryItem.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, qty: true },
      }),
      heldByItem(windowKeyAt()),
    ]);
    invOptions = invItems.map((it) => ({
      id: it.id,
      name: it.name,
      available: Math.max(0, it.qty - (held[it.id] ?? 0)),
    }));
  }

  return (
    <>
      <Topbar backHref={backHref} title="발주 수정 (관리자)" />
      <div className="page">
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          <b>{order.user.storeName}</b> · {ROLE_LABEL[ownerRole]} 발주를 수정합니다.
          저장하면 점주와 받는 업체에 &lsquo;발주 수정&rsquo; 알림이 전송됩니다.
        </div>
        <EditOrderForm
          orderId={order.id}
          category={order.category as Category}
          receiver={receiverLabel(order.category as Category, ownerRole)}
          initialItems={initialItems}
          needsPickup={needsPickupTime(ownerRole)}
          initialPickup={order.pickupTime ?? ""}
          needsFulfillment={needsFulfillment(ownerRole)}
          initialFulfillment={(order.fulfillment as Fulfillment | null) ?? ""}
          address={order.user.address ?? ""}
          admin
          invOptions={invOptions}
        />
      </div>
    </>
  );
}
