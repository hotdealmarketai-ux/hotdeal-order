// 미수(발행됐지만 미입금 = ISSUED 계산서) 관련 조회 helper. 서버 전용.
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";
import {
  currentWindowStartUtc,
  isOrderOpen,
  nextOpenUtc,
} from "@/lib/schedule";

// 어떤 시각(instant)이 '어느 발주창'에 속하는지 식별하는 키(그 창 시작일, KST).
// 평일=그날 12시창, 주말(토12시~일20시)=토요일 하나의 창.
export function windowKeyAt(nowMs: number): string {
  return kstDateOf(new Date(currentWindowStartUtc(nowMs)));
}

// 해제(unlock) 시각이 겨냥하는 발주창의 키. 창이 열려있을 때 누르면 그 창,
// 창 밖(정오 전·마감 후)에 누르면 '다음 발주창'을 겨냥한 것으로 본다.
// → 관리자가 아침(정오 전)이나 전날 밤에 해제해도 그 다음 발주에서 유효(1회성 유지).
function unlockTargetWindowKey(unlockMs: number): string {
  const targetStart = isOrderOpen(unlockMs)
    ? currentWindowStartUtc(unlockMs)
    : nextOpenUtc(unlockMs);
  return kstDateOf(new Date(targetStart));
}

// 수동 해제가 '이번(현재) 발주창'에 유효한가(1회성). orderLockOf와 화면 배지가 공유한다.
export function isUnlockActiveThisWindow(
  orderUnlock: boolean,
  orderUnlockAt?: Date | null,
  nowMs: number = Date.now(),
): boolean {
  return (
    orderUnlock &&
    !!orderUnlockAt &&
    unlockTargetWindowKey(orderUnlockAt.getTime()) === windowKeyAt(nowMs)
  );
}

// 점포의 미수 잔액(발행·미입금 계산서 합) + 미입금 건수
export async function receivableOf(
  userId: string,
): Promise<{ balance: number; count: number }> {
  const ar = await prisma.invoice.aggregate({
    where: { userId, status: "ISSUED" },
    _sum: { total: true },
    _count: true,
  });
  return { balance: ar._sum.total ?? 0, count: ar._count };
}

// 1일 미수 잠금: '이번 발주창 시작 이전' 날짜의 미입금 계산서가 있으면 이번 창 발주 잠금.
// (주말 연속창(토12시~일20시) 안에서 발행된 건 같은 창이라 과잉 잠금하지 않음)
// 수동 해제(orderUnlock)는 해제한 그 '발주창'에만 유효(1회성) — 다음 창엔 미수 남으면 다시 잠긴다.
export async function orderLockOf(
  userId: string,
  orderUnlock: boolean,
  orderUnlockAt?: Date | null,
): Promise<{ locked: boolean; unpaidDate: string | null; unpaidTotal: number }> {
  const now = Date.now();
  const windowStart = new Date(currentWindowStartUtc(now));
  // 해제가 '이번 발주창'을 겨냥한 것일 때만 인정(1회성). 다음 창으로 넘어가면 stale → 다시 잠금.
  const unlockedThisWindow = isUnlockActiveThisWindow(orderUnlock, orderUnlockAt, now);
  const windowStartDate = kstDateOf(windowStart);
  const past = await prisma.invoice.findFirst({
    where: { userId, status: "ISSUED", date: { lt: windowStartDate } },
    orderBy: { date: "asc" },
    select: { date: true, total: true },
  });
  return {
    locked: !!past && !unlockedThisWindow,
    unpaidDate: past?.date ?? null,
    unpaidTotal: past?.total ?? 0,
  };
}
