// 미수(발행됐지만 미입금 = ISSUED 계산서) 관련 조회 helper. 서버 전용.
import { prisma } from "@/lib/prisma";
import { kstDateOf } from "@/lib/date";
import { currentWindowStartUtc } from "@/lib/schedule";

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
// orderUnlock(관리자 임의 해제)이면 잠기지 않는다.
export async function orderLockOf(
  userId: string,
  orderUnlock: boolean,
): Promise<{ locked: boolean; unpaidDate: string | null; unpaidTotal: number }> {
  const windowStartDate = kstDateOf(new Date(currentWindowStartUtc()));
  const past = await prisma.invoice.findFirst({
    where: { userId, status: "ISSUED", date: { lt: windowStartDate } },
    orderBy: { date: "asc" },
    select: { date: true, total: true },
  });
  return {
    locked: !!past && !orderUnlock,
    unpaidDate: past?.date ?? null,
    unpaidTotal: past?.total ?? 0,
  };
}
