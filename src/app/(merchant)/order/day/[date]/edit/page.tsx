// 통합 '발주 수정' — 그 날짜의 전 카테고리(과일·야채·공구·채움채)를 한 폼에서 수정/추가.
// 안 넣었던 종류도 여기서 추가할 수 있어 별도 '발주 추가' 화면을 대체한다.
// 핫딜마켓(발주창 보유) 전용. 저장은 OrderForm의 수정 모드 → updateDayOrderAction.
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding } from "@/lib/onboarding";
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
import { orderChannelConfig, fixedItemsByCat } from "@/lib/order-flags";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import { OrderForm, type ToolHold } from "@/components/OrderForm";
import { type StockPickItem } from "@/components/StockPickerSheet";

export default async function EditDayOrderPage(props: {
  params: Promise<{ date: string }>;
}) {
  const user = await requireMerchant();
  if (needsOnboarding(user)) redirect("/onboarding");
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

  // 일반 발주 관리 — 과일/야채 품목 고정(수정 시에도 고정 렌더 유지)
  const channelCfg = await orderChannelConfig();
  const fixedItems =
    channelCfg.fixedFruit || channelCfg.fixedVeg
      ? await fixedItemsByCat(true)
      : { FRUIT: [], VEG: [] };

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

  // 품목 고정 카테고리에서 '이미 발주했으나 현재 목록에 없는(미노출/개명)' 품목은 고정 목록에 합류시켜
  // 수정 화면에 그대로 표시·수량 시드되게 한다(무경고 삭제 방지, 리뷰 #5).
  if (channelCfg.fixedFruit || channelCfg.fixedVeg) {
    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    for (const cat of ["FRUIT", "VEG"] as const) {
      const on = cat === "FRUIT" ? channelCfg.fixedFruit : channelCfg.fixedVeg;
      if (!on) continue;
      const have = new Set(fixedItems[cat].map((i) => norm(i.name)));
      (initialRowsByCat[cat] ?? []).forEach((r, i) => {
        if (r.name && !have.has(norm(r.name))) {
          fixedItems[cat].push({ id: `legacy-${cat}-${i}`, name: r.name });
          have.add(norm(r.name));
        }
      });
    }
  }

  // 공구 담기(toolCart) + 예약분(reservedTool) — order/page.tsx와 동일.
  const orderDay = kstToday();
  const reservedTool = await getReservationLoadForOrder(user.id, orderDay);
  const reservedLabel =
    reservedTool.length > 0
      ? `픽업 ${labelDate(shiftDate(orderDay, 1))} 예약분`
      : "";

  // 공구(TOOL)는 예약발주 단일 소스로 전환 — 재고현황 담기 폐지. 공구칸엔 예약분(reservedTool)만.
  const invOptions: StockPickItem[] = [];
  const toolCart: ToolHold[] = [];

  return (
    <>
      <Topbar
        backHref={backHref}
        title="발주 수정"
        right={<TopbarChip>{user.storeName}</TopbarChip>}
      />
      <div className="page">
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
          invOptions={invOptions}
          fixedFruit={channelCfg.fixedFruit}
          fixedVeg={channelCfg.fixedVeg}
          fixedItems={fixedItems}
        />
      </div>
    </>
  );
}
