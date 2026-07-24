// 일반발주(핫딜마켓) 발주창 열림 판정 + 관리자 강제 오픈(개발/특례) 토글.
// 주간발주 weeklyForceOpen 과 같은 방식(AppMeta presence). 12~20시가 아니어도 발주를 열 수 있음.
import { prisma } from "@/lib/prisma";
import { isOrderOpen, hasOrderWindow } from "@/lib/deadline";
import type { Role } from "@/lib/constants";

const KEY = "daily_force_open";

const FORCE_OPEN_TTL_MS = 18 * 60 * 60 * 1000; // 18시간

export async function dailyForceOpen(): Promise<boolean> {
  const m = await prisma.appMeta.findUnique({ where: { key: KEY } });
  if (!m) return false;
  // 자동 만료 — 켠 지 18시간이 지나면 무효로 본다(관리자가 끄는 걸 잊어도 다음날 자동 해제).
  // syncedAt = 마지막으로 ON 한 시각(setDailyForceOpen에서 갱신).
  if (Date.now() - m.syncedAt.getTime() > FORCE_OPEN_TTL_MS) return false;
  return true;
}

export async function setDailyForceOpen(on: boolean): Promise<void> {
  if (on) {
    await prisma.appMeta.upsert({
      where: { key: KEY },
      create: { key: KEY },
      update: { syncedAt: new Date() },
    });
  } else {
    await prisma.appMeta.deleteMany({ where: { key: KEY } });
  }
}

// 지금 이 역할이 발주(담기 포함) 가능한가 — 창 없는 역할=항상, 운영시간, 또는 관리자 강제오픈.
export async function orderOpenNow(role: Role, now: number = Date.now()): Promise<boolean> {
  if (!hasOrderWindow(role)) return true;
  if (isOrderOpen(now)) return true;
  return dailyForceOpen();
}
