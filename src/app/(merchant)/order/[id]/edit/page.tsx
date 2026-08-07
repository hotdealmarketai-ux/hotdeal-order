import { Topbar } from "@/components/Topbar";
import { notFound, redirect } from "next/navigation";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  receiverLabel,
  needsPickupTime,
  needsFulfillment,
  type Category,
  type Fulfillment,
} from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
} from "@/lib/deadline";
import { kstDateOf } from "@/lib/date";
import { heldByItem, myHolds } from "@/lib/stock-hold";
import { windowKeyAt } from "@/lib/schedule";
import { EditOrderForm } from "@/components/EditOrderForm";
import type { ToolHold } from "@/components/OrderForm";
import type { StockPickItem } from "@/components/StockPickerSheet";

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

  // 공구(TOOL) 수정 = 실시간 담기. toolCart(내 담기, 발주 당시 창)를 실시간 스테퍼로 조절하고,
  // 없는 품목은 재고 검색 팝업(invOptions)으로 담는다(holdStockAction). 저장 시 서버가 myHolds로 재구성.
  // 남은수량 = base − Σ담기홀드. 수정은 항상 이번 발주창이라 windowKeyAt()=발주 당시 창.
  let toolCart: ToolHold[] = [];
  let invOptions: StockPickItem[] = [];
  if (order.category === "TOOL") {
    const holdKey = windowKeyAt();
    const [mine, held, invItems] = await Promise.all([
      myHolds(user.id, holdKey),
      heldByItem(holdKey),
      prisma.inventoryItem.findMany({
        where: { deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: {
          id: true,
          name: true,
          qty: true,
          supplyPrice: true,
          expiry: true,
          majorCat: true,
          minorCat: true,
        },
      }),
    ]);
    const invById = new Map(invItems.map((i) => [i.id, i]));
    toolCart = mine.map((h) => {
      const inv = invById.get(h.itemId);
      const base = inv?.qty ?? 0;
      return {
        itemId: h.itemId,
        name: h.name,
        qty: String(h.qty),
        mine: h.qty,
        available: Math.max(0, base - (held[h.itemId] ?? 0)),
        supplyPrice: inv?.supplyPrice ?? 0,
        expiry: inv?.expiry ?? "",
        majorCat: inv?.majorCat ?? "",
        minorCat: inv?.minorCat ?? "",
      };
    });
    invOptions = invItems.map((it) => ({
      id: it.id,
      name: it.name,
      available: Math.max(0, it.qty - (held[it.id] ?? 0)),
    }));
  }

  return (
    <>
      <Topbar backHref={backHref} title="발주 수정" />
      <div className="page">
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          저장하면 &lsquo;발주 수정&rsquo;으로 표시됩니다.
        </div>
        <EditOrderForm
          orderId={order.id}
          category={order.category as Category}
          receiver={receiverLabel(order.category as Category, user.role)}
          initialItems={initialItems}
          needsPickup={needsPickupTime(user.role)}
          initialPickup={order.pickupTime ?? ""}
          needsFulfillment={needsFulfillment(user.role)}
          initialFulfillment={(order.fulfillment as Fulfillment | null) ?? ""}
          address={user.address ?? ""}
          toolCart={toolCart}
          invOptions={invOptions}
        />
      </div>
    </>
  );
}
