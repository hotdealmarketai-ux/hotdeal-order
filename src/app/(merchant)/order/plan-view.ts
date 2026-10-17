// ============================================================
//  품목 제한 모드 — 점주 발주 화면용 편성 묶음(서버 전용)
//  · merchantPlanView(order-plan.ts) 결과를 점주 화면에 필요한 칸만 추려 넘긴다
//    (공급가·연동 재고 번호 같은 관리용 칸은 화면에 실어 보내지 않음).
//  · 새 발주(order/page.tsx)·하루 수정(order/day/[date]/edit) 이 같이 쓴다.
// ============================================================

import type { MerchantPlanView } from "@/lib/order-plan";
import { isPlanCat, PLAN_CATS } from "@/lib/order-plan";
import type { Category } from "@/lib/constants";
import type { PlanFormView } from "@/components/OrderForm";

/**
 * 제한 모드 점주 발주 화면에 넘길 종류 — 편성 종류 중 지금 받는 것(PLAN_CATS)만 남긴다(공구 탭 없음).
 * 채움채처럼 편성 줄이 아닌 종류는 그대로. 새 발주·하루 수정이 같은 목록을 써야 탭·확인 창·건수가 맞는다.
 */
export function restrictedCategories(cats: Category[]): Category[] {
  return cats.filter((c) => !isPlanCat(c) || PLAN_CATS.includes(c));
}

export function toPlanFormView(v: MerchantPlanView): PlanFormView {
  // 편성 종류에서 빠진 종류(공구)는 빈 칸으로 채운다(타입은 그대로 — 화면이 그 칸을 읽어도 깨지지 않게)
  const none = () => ({ exists: false, items: [] as PlanFormView["cats"]["FRUIT"]["items"] });
  const cats: PlanFormView["cats"] = { FRUIT: none(), VEG: none(), TOOL: none() };
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
