// 통합 '발주 수정' — 그 날짜의 전 카테고리(과일·야채·공구·채움채)를 한 폼에서 수정/추가.
// 안 넣었던 종류도 여기서 추가할 수 있어 별도 '발주 추가' 화면을 대체한다.
// 핫딜마켓(발주창 보유) 전용. 저장은 OrderForm의 수정 모드 → updateDayOrderAction.
// 날짜 = 발주창 키 K(normalizeWindowKey) — 주말 토·일은 한 창(토요일)으로 묶어 찾는다(windowOrdersWhere).
// 품목 제한 모드면 그 창 편성 줄(merchantPlanView)로 그리고, 편성 번호 없는 옛 줄은 읽기 전용으로 보여 준다.
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
import { hasOrderWindow, isOrderOpen } from "@/lib/deadline";
import {
  kstToday,
  normalizeDateStr,
  shipmentDayOf,
  shiftDate,
  labelDate,
} from "@/lib/date";
import { orderLockOf, orderTimeOpenForUser } from "@/lib/receivable";
import { getReservationLoadForOrder } from "@/lib/reservation-data";
import { myHolds, heldByItem } from "@/lib/stock-hold";
import { windowKeyAt, normalizeWindowKey } from "@/lib/schedule";
import { orderChannelConfig, fixedItemsByCat } from "@/lib/order-flags";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import { qtyNum } from "@/lib/qty";
import { OrderForm, type ToolHold, type TofuChoice } from "@/components/OrderForm";
import { type StockPickItem } from "@/components/StockPickerSheet";
import { restrictModeFor, modeStamp } from "@/lib/restrict-mode";
import { merchantPlanView, windowOrdersWhere, parsePlanQty } from "@/lib/order-plan";
import { logError } from "@/lib/log";
import { toPlanFormView } from "../../../plan-view";
import "../../../order-plan-form.css";

export default async function EditDayOrderPage(props: {
  params: Promise<{ date: string }>;
}) {
  const user = await requireMerchant();
  if (needsOnboarding(user)) redirect("/onboarding");
  const { date: rawDate } = await props.params;
  // 발주창 키 K — 일요일 주소도 토요일 창으로(주말 토·일 중복 발주 9/26·27 실사례 해결).
  const date = normalizeWindowKey(normalizeDateStr(rawDate));
  const backHref = `/order/day/${date}`;

  // 통합 수정은 발주창 보유(멀티 카테고리) 핫딜마켓 전용.
  if (!hasOrderWindow(user.role)) redirect("/order");
  // 이번 발주창만 수정 가능. 시간 판정은 새 발주와 같은 기준(운영시간·강제오픈·지점 '시간 1회 열기').
  if (date !== windowKeyAt()) redirect(backHref);
  // 수정은 정규 발주 시간에만(20:05 채움채 자동제출 뒤 수정 방지 — 저장 쪽과 같은 기준)
  if (!isOrderOpen() || !(await orderTimeOpenForUser(user))) redirect(backHref);

  const orders = await prisma.order.findMany({
    where: windowOrdersWhere(user.id, date),
    include: { items: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
  if (orders.length === 0) redirect(backHref);

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
  const restricted = await restrictModeFor(user);

  // 일반 발주 관리 — 과일/야채 품목 고정(수정 시에도 고정 렌더 유지)
  const channelCfg = await orderChannelConfig();
  const fixedItems =
    !restricted && (channelCfg.fixedFruit || channelCfg.fixedVeg)
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
        if (!p) continue;
        const q = String(it.qty || it.rawQty || "").trim();
        // 주말 토·일 옛 중복 발주는 한 창으로 묶이니 같은 품목 수량을 더한다(덮어쓰면 한쪽이 사라짐)
        const prev = initialTofuQty[p.seq];
        initialTofuQty[p.seq] = prev ? String(Math.round((qtyNum(prev) + qtyNum(q)) * 100) / 100) : q;
      }
      continue;
    }
    // 같은 종류 발주가 둘 이상(주말 토·일 중복 등)이면 이어 붙여 모두 보이게 한다.
    initialRowsByCat[o.category] = [
      ...(initialRowsByCat[o.category] ?? []),
      ...o.items.map((it) => ({
        name: it.name,
        qty: it.qty,
        note: it.note,
      })),
    ];
  }

  // 품목 고정 카테고리에서 '이미 발주했으나 현재 목록에 없는(미노출/개명)' 품목은 고정 목록에 합류시켜
  // 수정 화면에 그대로 표시·수량 시드되게 한다(무경고 삭제 방지, 리뷰 #5).
  if (!restricted && (channelCfg.fixedFruit || channelCfg.fixedVeg)) {
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

  // 공구 담기(toolCart)·재고 검색(invOptions) — 제한 모드에선 쓰지 않는다(공구도 편성 줄).
  let invOptions: StockPickItem[] = [];
  let toolCart: ToolHold[] = [];
  if (!restricted) {
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
    // 공구 '재고에서 검색·담기' 팝업용 — 남은 재고(base − Σ담기홀드) 포함.
    invOptions = invItems.map((it) => ({
      id: it.id,
      name: it.name,
      available: Math.max(0, it.qty - (held[it.id] ?? 0)),
    }));
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
  }

  // ── 품목 제한 모드 — 그 창 편성 줄 + 이미 넣은 수량 시드 ──
  //  · 편성 번호(planItemId) 있는 줄 → 그 품목 수량으로 미리 채움
  //  · 편성 번호 없는 옛 줄(모드 켜기 전 자유 입력·담기) → '이전 방식 발주 · 그대로 유지' 읽기 전용
  //  · 채움채 → 그날 보이는 품목 + 이미 발주한 숨김 품목('숨김 · 이미 발주')
  const rawPlan = restricted
    ? await merchantPlanView(date, user.id).catch((err) => {
        logError("order.dayEdit.planView", err, { userId: user.id, date });
        return null;
      })
    : null;
  const planView = rawPlan ? toPlanFormView(rawPlan) : undefined;
  const initialPlanQty: Record<string, number> = {};
  const legacyRowsByCat: Partial<Record<"FRUIT" | "VEG" | "TOOL", { name: string; qty: string }[]>> = {};
  let tofuList: TofuChoice[] | undefined;
  if (rawPlan) {
    for (const o of orders) {
      if (o.category !== "FRUIT" && o.category !== "VEG" && o.category !== "TOOL") continue;
      const cat = o.category;
      for (const it of o.items) {
        if (it.planItemId) {
          initialPlanQty[it.planItemId] = (initialPlanQty[it.planItemId] ?? 0) + parsePlanQty(it.qty);
        } else {
          (legacyRowsByCat[cat] ??= []).push({ name: it.name, qty: it.qty });
        }
      }
    }
    const hidden = new Set(rawPlan.tofu.hiddenSeqs);
    tofuList = CHAEUMCHAE_CATALOG.filter(
      (p) => !hidden.has(p.seq) || (initialTofuQty[p.seq] ?? "").trim(),
    ).map((p) => ({ seq: p.seq, name: p.name, hiddenOrdered: hidden.has(p.seq) }));
  }

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
          restricted={restricted}
          planView={planView}
          restrictStamp={restricted ? modeStamp(true, date) : undefined}
          tofuList={tofuList}
          initialPlanQty={initialPlanQty}
          legacyRowsByCat={legacyRowsByCat}
        />
      </div>
    </>
  );
}
