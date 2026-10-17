// ============================================================
//  품목 제한 모드 — 점주 발주 화면용 편성 묶음(서버 전용)
//  · merchantPlanView(order-plan.ts) 결과를 점주 화면에 필요한 칸만 추려 넘긴다
//    (공급가·연동 재고 번호 같은 관리용 칸은 화면에 실어 보내지 않음).
//  · 새 발주(order/page.tsx)·하루 수정(order/day/[date]/edit) 이 같이 쓴다.
// ============================================================

import type { MerchantPlanView } from "@/lib/order-plan";
import { PLAN_CATS } from "@/lib/order-plan";
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
