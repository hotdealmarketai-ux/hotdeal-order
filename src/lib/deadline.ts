// 핫딜마켓 가맹점 발주 마감 — 매일 오후 8시(KST)
import type { Role } from "@/lib/constants";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 발주 마감 시각 (KST, 24시간제) */
export const ORDER_DEADLINE_HOUR = 20;
export const ORDER_DEADLINE_LABEL = "오후 8시";

/** 이 역할이 일일 발주 마감의 적용을 받는가 (핫딜마켓 가맹점만) */
export function hasOrderDeadline(role: Role): boolean {
  return role === "MERCHANT_HOTDEAL";
}

/** 지금(KST) 발주 마감을 지났는가 */
export function isPastOrderDeadline(now: number = Date.now()): boolean {
  const kst = new Date(now + KST_OFFSET_MS);
  return kst.getUTCHours() >= ORDER_DEADLINE_HOUR;
}
