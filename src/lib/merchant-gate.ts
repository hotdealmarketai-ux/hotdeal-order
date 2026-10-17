// ============================================================
//  점주 메뉴 관문 — 재고현황·공산품(옛 예약발주) 페이지 공용 검사
//  · 판정은 restrict-mode.ts(merchantVisibility) 하나만 쓴다.
//  · Next 16 레이아웃은 화면을 옮겨도 다시 그리지 않으므로(docs glossary 'Layout'),
//    레이아웃뿐 아니라 각 page.tsx 에서도 이 함수를 부른다.
//  · 재고현황이 막혀 돌아갈 주소는 /order?n=restricted (발주 화면이 안내 띠를 띄움).
//  · 공산품은 품목 제한 모드와 상관없이 열린다(2026-10-17~ 공구는 공산품으로만 받음).
//    지점 '공산품 노출'만 꺼진 경우 예전처럼 /order 로.
// ============================================================

import { redirect } from "next/navigation";
import { merchantVisibility } from "@/lib/restrict-mode";
import type { AppUser } from "@/lib/session";

export const RESTRICTED_BOUNCE = "/order?n=restricted";

/** 공산품이 이 지점에 보이지 않으면(지점 '공산품 노출' 꺼짐) 발주 화면으로 돌려보낸다. */
export async function requireReservationsVisible(user: AppUser): Promise<void> {
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const vis = await merchantVisibility(user);
  if (!vis.reservations) redirect("/order");
}

/** 재고현황이 이 지점에 보이지 않으면(제한 모드) 발주 화면으로 돌려보낸다. */
export async function requireInventoryVisible(user: AppUser): Promise<void> {
  const vis = await merchantVisibility(user);
  if (!vis.inventory) redirect(RESTRICTED_BOUNCE);
}

// ── 쓰기 경로(서버 액션) 관문 ─────────────────────────────
// 서버 액션은 POST 주소라 화면을 숨겨도 직접 호출될 수 있다.

/**
 * 점주 공산품 담기·발주·취소 직전 검사. 막아야 하면 점주에게 보일 문구, 통과면 null.
 * · 지점 '공산품 노출' off → '권한이 없어요.'(기존 문구 그대로)
 * · 품목 제한 모드는 더 이상 막지 않는다(merchantVisibility.reservations 와 같은 판정).
 */
export async function reservationWriteBlock(
  user: Pick<AppUser, "id" | "role" | "reservationEnabled">,
): Promise<{ kind: "hidden"; message: string } | null> {
  if (!user.reservationEnabled) return { kind: "hidden", message: "권한이 없어요." };
  return null;
}
