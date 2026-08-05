// 미수(발행됐지만 미입금 = ISSUED 계산서) 관련 조회 helper. 서버 전용.
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";
import {
  currentWindowStartUtc,
  isOrderOpen,
  nextOpenUtc,
} from "@/lib/schedule";
import { orderLockOverride } from "@/lib/order-open";

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

// 점포의 미수 잔액(발행·미입금 계산서 합 + 관리자 조정) + 미입금 계산서 건수.
// '받을 총액' = 지점 단위 유일 진실. 매칭 입금·수동조정이 모두 조정에 반영되므로 화면 간 자동 일관.
// ※ 결제 안내·발주 잠금·연체 안내·배지는 전부 이 '지점 총미수'로만 판단한다(2026-08-05~). 계산서 낱장이
//    결제됐는지는 매칭이 지점 단위라 알 수 없어(낱장 추정=이중납부 위험), 낱장 계산서는 '영수증'으로만 본다.
export async function receivableOf(
  userId: string,
): Promise<{ balance: number; count: number }> {
  // 미수 = 발행·미입금 계산서 합 + 관리자 조정(ReceivableAdjustment) 합.
  // · 조정에는 (a) 관리자 수동 조정(입금 누락·반품·오류 정정)과 (b) 입금 매칭 조정이 함께 들어간다.
  //   입금 매칭 = 관리자가 입출금내역에서 점포로 매칭한 입금(2026-08-05~). 매칭 시 −금액 조정(depositId 링크)이
  //   생성돼 여기 adj 합에 반영된다 → 미수가 그 입금만큼 감소. 매칭 해제 시 그 조정을 삭제해 원복.
  // · 이 방식(매칭=조정)은 미수를 계산하는 모든 화면(발행/미수/마감/입금관리)이 이미 조정을 합산하므로 자동 일관.
  //   더 이상 계산서 개별 '입금확인'으로 미수를 깎지 않는다(이중차감 방지). 미수 감소 창구는 매칭·수동조정뿐.
  const [ar, adj] = await Promise.all([
    prisma.invoice.aggregate({
      where: { userId, status: "ISSUED" },
      _sum: { total: true },
      _count: true,
    }),
    prisma.receivableAdjustment.aggregate({
      where: { userId },
      _sum: { amount: true },
    }),
  ]);
  return {
    balance: (ar._sum.total ?? 0) + (adj._sum.amount ?? 0),
    count: ar._count,
  };
}

// 1일 미수 잠금: '이번 발주창 시작 이전' 날짜의 미입금(ISSUED) 일반 계산서가 있고 + 지점 미수 잔액이 남아 있으면
// 이번 창 발주 잠금. (주말 연속창(토12시~일20시) 안에서 발행된 건 같은 창이라 과잉 잠금하지 않음)
// 수동 해제(orderUnlock)는 해제한 그 '발주창'에만 유효(1회성) — 다음 창엔 미수 남으면 다시 잠긴다.
// ※ 계산서 개별 '입금확인'을 없애 결제 후에도 ISSUED로 남으므로, '낱장 정산 여부'가 아니라 '지점 총미수(receivableOf)'로
//    판정한다. 매칭이 지점 단위라 낱장 추정은 부정확·이중납부 위험이라 폐기(2026-08-05). 안내 금액도 지점 총미수.
export async function orderLockOf(
  userId: string,
  orderUnlock: boolean,
  orderUnlockAt?: Date | null,
): Promise<{ locked: boolean; unpaidDate: string | null; unpaidTotal: number }> {
  // 전체 잠금해제 토글 ON → 미수 있어도 발주 허용.
  if (await orderLockOverride()) return { locked: false, unpaidDate: null, unpaidTotal: 0 };
  const now = Date.now();
  const windowStart = new Date(currentWindowStartUtc(now));
  // 해제가 '이번 발주창'을 겨냥한 것일 때만 인정(1회성). 다음 창으로 넘어가면 stale → 다시 잠금.
  const unlockedThisWindow = isUnlockActiveThisWindow(orderUnlock, orderUnlockAt, now);
  const windowStartDate = kstDateOf(windowStart);
  const past = await prisma.invoice.findFirst({
    where: { userId, status: "ISSUED", kind: "DAILY", date: { lt: windowStartDate } },
    orderBy: { date: "asc" },
    select: { id: true },
  });
  if (!past) return { locked: false, unpaidDate: null, unpaidTotal: 0 };
  const { balance } = await receivableOf(userId);
  return {
    locked: !unlockedThisWindow && balance > 0,
    unpaidDate: null,
    unpaidTotal: Math.max(0, balance),
  };
}
