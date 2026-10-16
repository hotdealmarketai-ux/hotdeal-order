import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { windowKeyAt } from "@/lib/schedule";
import { restrictModeFor } from "@/lib/restrict-mode";
import { merchantPlanView, PLAN_CATS } from "@/lib/order-plan";

// 품목 제한 모드 — 편성 품목 남은 수량 실시간 폴링 소스(useLivePlan 이 4초마다 읽음).
// 계산은 점주 발주 화면과 같은 merchantPlanView(같은 숫자 같은 계산).
//   items[planItemId] = { remaining(전 지점 기준 남은, null=무제한), maxForMe(이 지점 최대, 내 수량 포함), mine(내가 넣은) }
// 숨긴 품목은 내가 이미 넣은 경우에만 들어 있다(화면은 '목록에 없음 = 판매 종료'로 본다).
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET() {
  const windowKey = windowKeyAt();
  const user = await getCurrentUser();
  if (!user || user.role !== "MERCHANT_HOTDEAL") {
    return NextResponse.json({ windowKey, restricted: false, items: {} }, { headers: NO_STORE });
  }
  const restricted = await restrictModeFor(user);
  if (!restricted) {
    return NextResponse.json({ windowKey, restricted: false, items: {} }, { headers: NO_STORE });
  }
  try {
    const view = await merchantPlanView(windowKey, user.id);
    const items: Record<string, { remaining: number | null; maxForMe: number | null; mine: number }> = {};
    for (const c of PLAN_CATS) {
      for (const it of view.cats[c].items) {
        items[it.id] = { remaining: it.remaining, maxForMe: it.maxForMe, mine: it.mine };
      }
    }
    return NextResponse.json({ windowKey, restricted: true, items }, { headers: NO_STORE });
  } catch {
    // 일시 오류 — 화면은 마지막 값을 그대로 쓰고 다음 주기에 다시 읽는다.
    return NextResponse.json({ error: "잠시 후 다시 시도해 주세요." }, { status: 503, headers: NO_STORE });
  }
}
