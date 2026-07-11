// 주간발주 미수/잠금 helper — 일일 발주(receivable.ts)와 완전 독립(kind="WEEKLY", 토요일 주간창 기준).
// 서버 전용.
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";
import {
  currentWeeklyWindowStartUtc,
  nextWeeklyOpenUtc,
  isWeeklyOpen,
} from "@/lib/schedule";

// 이번 주간 사이클 키(그 주 토요일 KST 날짜) — 주(週) 식별자.
export function weeklyKeyAt(nowMs: number = Date.now()): string {
  return kstDateOf(new Date(currentWeeklyWindowStartUtc(nowMs)));
}

// 해제(unlock)가 겨냥하는 주간 사이클 키. 주간창이 열려있을 때 누르면 그 주,
// 창 밖(주중·마감후)에 누르면 '다음 토요일 주간창'을 겨냥한 것으로 본다(1회성 유지).
function unlockTargetWeeklyKey(unlockMs: number): string {
  const target = isWeeklyOpen(unlockMs)
    ? currentWeeklyWindowStartUtc(unlockMs)
    : nextWeeklyOpenUtc(unlockMs);
  return kstDateOf(new Date(target));
}

// 주간 수동 해제가 '이번(현재) 주간 사이클'에 유효한가(1회성). 잠금판정과 화면 배지가 공유.
export function isWeeklyUnlockActive(
  weeklyOrderUnlock: boolean,
  weeklyOrderUnlockAt?: Date | null,
  nowMs: number = Date.now(),
): boolean {
  return (
    weeklyOrderUnlock &&
    !!weeklyOrderUnlockAt &&
    unlockTargetWeeklyKey(weeklyOrderUnlockAt.getTime()) === weeklyKeyAt(nowMs)
  );
}

// 주간 미수(발행·미입금 WEEKLY 계산서 합) + 건수
export async function weeklyReceivableOf(
  userId: string,
): Promise<{ balance: number; count: number }> {
  const ar = await prisma.invoice.aggregate({
    where: { userId, status: "ISSUED", kind: "WEEKLY" },
    _sum: { total: true },
    _count: true,
  });
  return { balance: ar._sum.total ?? 0, count: ar._count };
}

// 주간 발주 잠금: '이번 주간창 시작 이전에 발행된' 미입금 주간 입금요청서가 있으면 이번 주간발주 잠금.
// (주간 요청서는 출고일(수)에 발행 → 다음 토요일 12시 전까지 입금해야 함. 안 되면 그 주 주간발주 못 넣음.)
export async function weeklyLockOf(
  userId: string,
  weeklyOrderUnlock: boolean,
  weeklyOrderUnlockAt?: Date | null,
): Promise<{ locked: boolean; unpaidDate: string | null; unpaidTotal: number }> {
  const now = Date.now();
  const windowStart = new Date(currentWeeklyWindowStartUtc(now));
  const unlockedThisWeek = isWeeklyUnlockActive(
    weeklyOrderUnlock,
    weeklyOrderUnlockAt,
    now,
  );
  const past = await prisma.invoice.findFirst({
    where: {
      userId,
      kind: "WEEKLY",
      status: "ISSUED",
      issuedAt: { lt: windowStart },
    },
    orderBy: { issuedAt: "asc" },
    select: { date: true, total: true },
  });
  return {
    locked: !!past && !unlockedThisWeek,
    unpaidDate: past?.date ?? null,
    unpaidTotal: past?.total ?? 0,
  };
}

// 주간 미수(ISSUED WEEKLY)가 모두 정산되면 관리자 임의 잠금해제를 자동 원복.
export async function clearWeeklyUnlockIfSettled(userId: string) {
  const remaining = await prisma.invoice.count({
    where: { userId, status: "ISSUED", kind: "WEEKLY" },
  });
  if (remaining === 0) {
    await prisma.user.updateMany({
      where: { id: userId, weeklyOrderUnlock: true },
      data: { weeklyOrderUnlock: false, weeklyOrderUnlockAt: null },
    });
  }
}
