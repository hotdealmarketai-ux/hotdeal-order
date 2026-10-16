// ============================================================
//  품목 제한 모드 — 점주 발주 화면용 편성 묶음(서버 전용)
//  · merchantPlanView(order-plan.ts) 결과를 점주 화면에 필요한 칸만 추려 넘긴다
//    (공급가·연동 재고 번호 같은 관리용 칸은 화면에 실어 보내지 않음).
//  · 새 발주(order/page.tsx)·하루 수정(order/day/[date]/edit) 이 같이 쓴다.
// ============================================================

import type { MerchantPlanView } from "@/lib/order-plan";
import { PLAN_CATS } from "@/lib/order-plan";
import { shipmentDayOf, dowOf } from "@/lib/date";
import type { PlanFormView } from "@/components/OrderForm";

export function toPlanFormView(v: MerchantPlanView): PlanFormView {
  const cats = {} as PlanFormView["cats"];
  for (const c of PLAN_CATS) {
    cats[c] = {
      exists: v.cats[c].exists,
      items: v.cats[c].items.map((it) => ({
        id: it.id,
        category: it.category,
        name: it.name,
        description: it.description,
        maxPerStore: it.maxPerStore,
        minPerStore: it.minPerStore,
        linked: it.linked,
        hidden: it.hidden,
        mine: it.mine,
        remaining: it.remaining,
        maxForMe: it.maxForMe,
      })),
    };
  }
  return { windowKey: v.windowKey, cats };
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

function md(dateStr: string): { m: number; d: number; w: string } {
  const [, m, d] = dateStr.split("-").map((x) => parseInt(x, 10));
  return { m, d, w: DOW[dowOf(dateStr)] };
}

/**
 * 발주창 안내 문구 — '10월 15일(수) 발주 → 16일(목) 출고'.
 * 토요일 창은 '10월 17일(토)·18일(일) 발주 → 20일(월) 출고'. 달이 바뀌면 출고일에도 월을 붙인다.
 */
export function windowShipLabel(windowKey: string): string {
  const a = md(windowKey);
  const ship = md(shipmentDayOf(windowKey));
  const isSat = dowOf(windowKey) === 6;
  let orderPart = `${a.m}월 ${a.d}일(${a.w})`;
  let lastM = a.m;
  if (isSat) {
    // 일요일 = 토요일 + 1일(출고일 − 1일)
    const sunKey = new Date(Date.parse(`${windowKey}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const s = md(sunKey);
    orderPart += s.m === a.m ? `·${s.d}일(${s.w})` : `·${s.m}월 ${s.d}일(${s.w})`;
    lastM = s.m;
  }
  const shipPart = ship.m === lastM ? `${ship.d}일(${ship.w})` : `${ship.m}월 ${ship.d}일(${ship.w})`;
  return `${orderPart} 발주 → ${shipPart} 출고`;
}
