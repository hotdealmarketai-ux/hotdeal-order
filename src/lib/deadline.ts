// 핫딜마켓 가맹점 발주 운영시간 — 역할별 가드. 시간 규칙은 lib/schedule.ts(주말 규칙 포함).
import type { Role } from "@/lib/constants";
import {
  isOrderOpen,
  currentWindowStartUtc,
  OPEN_HOUR,
  CLOSE_HOUR,
  ORDER_DEADLINE_LABEL,
  ORDER_OPEN_LABEL,
} from "@/lib/schedule";

export {
  isOrderOpen,
  currentWindowStartUtc,
  ORDER_DEADLINE_LABEL,
  ORDER_OPEN_LABEL,
};
export const ORDER_OPEN_HOUR = OPEN_HOUR;
export const ORDER_CLOSE_HOUR = CLOSE_HOUR;

/** 이 역할이 발주 운영시간 제한을 받는가 (핫딜마켓 가맹점만) */
export function hasOrderWindow(role: Role): boolean {
  return role === "MERCHANT_HOTDEAL";
}

/** 이 사용자가 지금 발주/수정 가능한가 (소매업자는 항상 true) */
export function canOrderNow(role: Role, now: number = Date.now()): boolean {
  if (!hasOrderWindow(role)) return true;
  return isOrderOpen(now);
}
