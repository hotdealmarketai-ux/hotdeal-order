// ============================================================
//  점주 메뉴 관문 — 재고현황·예약발주 페이지 공용 검사
//  · 판정은 restrict-mode.ts(merchantVisibility) 하나만 쓴다.
//  · Next 16 레이아웃은 화면을 옮겨도 다시 그리지 않으므로(docs glossary 'Layout'),
//    레이아웃뿐 아니라 각 page.tsx 에서도 이 함수를 부른다.
//  · 막혀 돌아갈 주소는 /order?n=restricted (발주 화면이 안내 띠를 띄움).
//    지점 '예약발주 노출'만 꺼진 경우(제한 모드 아님)는 예전처럼 /order 로.
// ============================================================

import { redirect } from "next/navigation";
import { merchantVisibility, restrictModeForStrict } from "@/lib/restrict-mode";
import type { AppUser } from "@/lib/session";

export const RESTRICTED_BOUNCE = "/order?n=restricted";

/** 예약발주가 이 지점에 보이지 않으면 발주 화면으로 돌려보낸다. */
export async function requireReservationsVisible(user: AppUser): Promise<void> {
  if (user.role !== "MERCHANT_HOTDEAL") redirect("/order");
  const vis = await merchantVisibility(user);
  if (vis.reservations) return;
  redirect(vis.restricted ? RESTRICTED_BOUNCE : "/order");
}

/** 재고현황이 이 지점에 보이지 않으면(제한 모드) 발주 화면으로 돌려보낸다. */
export async function requireInventoryVisible(user: AppUser): Promise<void> {
  const vis = await merchantVisibility(user);
  if (!vis.inventory) redirect(RESTRICTED_BOUNCE);
}

// ── 쓰기 경로(서버 액션) 관문 ─────────────────────────────
// 서버 액션은 POST 주소라 화면을 숨겨도 직접 호출될 수 있다. 저장 판정(strict)이라 설정을 못 읽으면 막는다.

export const RESERVATION_RESTRICTED_MSG =
  "지금은 예약발주를 쓰지 않아요. 발주 화면에서 오늘 품목에 수량을 넣어 주세요.";
export const RETRY_LATER_MSG = "잠시 후 다시 시도해 주세요.";

/**
 * 점주 예약 담기·확정·취소 직전 검사. 막아야 하면 점주에게 보일 문구, 통과면 null.
 * · 지점 '예약발주 노출' off → '권한이 없어요.'(기존 문구 그대로)
 * · 품목 제한 모드 적용 중 → RESERVATION_RESTRICTED_MSG
 * · 설정 읽기 실패 → RETRY_LATER_MSG
 */
export async function reservationWriteBlock(
  user: Pick<AppUser, "id" | "role" | "reservationEnabled">,
): Promise<{ kind: "hidden" | "restricted" | "error"; message: string } | null> {
  if (!user.reservationEnabled) return { kind: "hidden", message: "권한이 없어요." };
  try {
    if (await restrictModeForStrict(user)) {
      return { kind: "restricted", message: RESERVATION_RESTRICTED_MSG };
    }
  } catch {
    return { kind: "error", message: RETRY_LATER_MSG };
  }
  return null;
}
