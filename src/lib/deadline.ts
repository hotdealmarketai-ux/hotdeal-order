// 핫딜마켓 가맹점 발주 운영시간
//  - 매일 낮 12시(정오) ~ 저녁 8시: 발주/수정 가능
//  - 저녁 8시 ~ 다음날 11:59: 출고시간 → 발주/수정 모두 불가
//  - 소매업자 등 그 외 역할: 제한 없음(무제한)
import type { Role } from "@/lib/constants";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export const ORDER_OPEN_HOUR = 12; // 정오 발주 시작
export const ORDER_CLOSE_HOUR = 20; // 오후 8시 발주 마감
export const ORDER_DEADLINE_LABEL = "오후 8시";
export const ORDER_OPEN_LABEL = "낮 12시";

/** 이 역할이 발주 운영시간 제한을 받는가 (핫딜마켓 가맹점만) */
export function hasOrderWindow(role: Role): boolean {
  return role === "MERCHANT_HOTDEAL";
}

function kstHour(now: number): number {
  return new Date(now + KST_OFFSET_MS).getUTCHours();
}

/** 지금(KST) 발주 가능한 시간대인가 (12시~20시) */
export function isOrderOpen(now: number = Date.now()): boolean {
  const h = kstHour(now);
  return h >= ORDER_OPEN_HOUR && h < ORDER_CLOSE_HOUR;
}

/** 이 사용자가 지금 발주/수정 가능한가 (소매업자는 항상 true) */
export function canOrderNow(role: Role, now: number = Date.now()): boolean {
  if (!hasOrderWindow(role)) return true;
  return isOrderOpen(now);
}
