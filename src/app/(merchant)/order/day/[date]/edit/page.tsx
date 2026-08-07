// 통합 '발주 수정' — 그 날짜의 전 카테고리(과일·야채·공구·채움채)를 한 폼에서 수정/추가.
// 안 넣었던 종류도 여기서 추가할 수 있어 별도 '발주 추가' 화면을 대체한다.
// 핫딜마켓(발주창 보유) 전용. 저장은 OrderForm의 수정 모드 → updateDayOrderAction.
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  allowedCategoriesFor,
  needsFulfillment,
  needsPickupTime,
  type Fulfillment,
} from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
} from "@/lib/deadline";
import {
  kstToday,
  kstDayRange,
  normalizeDateStr,
  shipmentDayOf,
  shiftDate,
  labelDate,
} from "@/lib/date";
import { orderLockOf } from "@/lib/receivable";
import { getReservationLoadForOrder } from "@/lib/reservation-data";
import { myHolds, heldByItem } from "@/lib/stock-hold";
import { windowKeyAt } from "@/lib/schedule";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import { OrderForm, type ToolHold } from "@/components/OrderForm";

export default async function EditDayOrderPage(props: {
  params: Promise<{ date: string }>;
}) {
  const user = await requireMerchant();
  const { date: rawDate } = await props.params;
  const date = normalizeDateStr(rawDate);
  const backHref = `/order/day/${date}`;

  // 통합 수정은 발주창 보유(멀티 카테고리) 핫딜마켓 전용.
  if (!hasOrderWindow(user.role)) redirect("/order");
  if (!isOrderOpen()) redirect(backHref);

  const { start, end } = kstDayRange(date);
  const orders = await prisma.order.findMany({
    where: {
      userId: user.id,
      createdAt: { gte: start, lt: end },
      status: { not: "CANCELLED" },
    },
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  if (orders.length === 0) redirect(backHref);
  // 지난 창(이미 출고 준비) 발주는 수정 불가
  if (orders.some((o) => o.createdAt.getTime() < currentWindowStartUtc())) {
    redirect(backHref);
  }

  // 계산서 발행분 잠금 (출고일 기준)
  const issued = await prisma.invoice.findFirst({
    where: {
      userId: user.id,
      kind: "DAILY",
      date: shipmentDayOf(date),
      status: { in: ["ISSUED", "PAID"] },
    },
    select: { id: true },
  });
  if (issued) redirect(backHref);

  // 미수 잠금
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) redirect("/order");

  const categories = allowedCategoriesFor(user.role);

  // 시드 — 종류별 기존 품목(현재 표시값=정리본). 공구=담기로 시드, 채움채=수량맵.
  const initialRowsByCat: Record<
    string,
    { name: string; qty: string; note: string }[]
  > = {};
  const initialTofuQty: Record<string, string> = {};
  let initialFulfillment: "" | Fulfillment = "";
  for (const o of orders) {
    if (o.fulfillment && !initialFulfillment) {
      initialFulfillment = o.fulfillment as Fulfillment;
    }
    if (o.category === "TOOL") continue; // 담기(toolCart)로 시드
    if (o.category === "TOFU") {
      for (const it of o.items) {
        const p = CHAEUMCHAE_CATALOG.find(
          (c) => c.name === it.name.trim() || c.name === it.rawName.trim(),
        );
        if (p) initialTofuQty[p.seq] = String(it.qty || it.rawQty || "").trim();
      }
      continue;
    }
    initialRowsByCat[o.category] = o.items.map((it) => ({
      name: it.name,
      qty: it.qty,
      note: it.note,
    }));
  }

  // 공구 담기(toolCart) + 예약분(reservedTool) — order/page.tsx와 동일.
  const orderDay = kstToday();
  const reservedTool = await getReservationLoadForOrder(user.id, orderDay);
  const reservedLabel =
    reservedTool.length > 0
      ? `픽업 ${labelDate(shiftDate(orderDay, 1))} 예약분`
      : "";

  const holdKey = windowKeyAt();
  const [mine, held, invItems] = await Promise.all([
    myHolds(user.id, holdKey),
    heldByItem(holdKey),
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        qty: true,
        supplyPrice: true,
        expiry: true,
        majorCat: true,
        minorCat: true,
      },
    }),
  ]);
  const invById = new Map(invItems.map((i) => [i.id, i]));
  const toolCart: ToolHold[] = mine.map((h) => {
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

  return (
    <>
      <Topbar
        backHref={backHref}
        title="발주 수정"
        right={<TopbarChip>{user.storeName}</TopbarChip>}
      />
      <div className="page">
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          넣지 않은 종류도 여기서 추가할 수 있어요. 저장하면 ‘발주 수정’으로
          표시됩니다. (종류 전체를 빼려면 발주 취소를 이용해 주세요.)
        </div>
        <OrderForm
          categories={categories}
          needsPickup={needsPickupTime(user.role)}
          needsFulfillment={needsFulfillment(user.role)}
          address={user.address ?? ""}
          role={user.role}
          reservedTool={reservedTool}
          reservedLabel={reservedLabel}
          toolCart={toolCart}
          editDate={date}
          initialRowsByCat={initialRowsByCat}
          initialTofuQty={initialTofuQty}
          initialFulfillment={initialFulfillment}
        />
      </div>
    </>
  );
}
