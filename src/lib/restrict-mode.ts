// ============================================================
//  품목 제한 모드 — 전역 스위치
//  · AppMeta `order_restrict_mode` : 키 있음 = 켜짐. value = JSON { from, pilot }
//      from  : 적용 시작 발주창 키(windowKeyAt). "" = 즉시. 이 키 이상인 창부터 적용.
//      pilot : 시험 지점 userId 목록. 비어 있으면 전 지점.
//  · 적용 대상은 핫딜마켓 가맹점(MERCHANT_HOTDEAL)만. 서부일광 소매는 창 규칙이 달라 제외.
//  · 화면 판정(restrictModeFor)은 DB 오류 시 '꺼짐'(발주를 막지 않음),
//    저장 판정(restrictModeForStrict)은 DB 오류 시 예외 → 호출부가 '잠시 후 다시'로 거절.
//    (설정 한 번 못 읽었다고 자유 품목 발주가 저장되는 일을 막는다)
// ============================================================

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import { windowKeyAt, isWindowKey } from "@/lib/schedule";

export const RESTRICT_KEY = "order_restrict_mode";

export type RestrictConfig = {
  on: boolean;
  from: string; // "" = 즉시
  pilot: string[]; // [] = 전 지점
  changedAt: Date | null;
};

const OFF: RestrictConfig = { on: false, from: "", pilot: [], changedAt: null };

function parseValue(v: string): { from: string; pilot: string[] } {
  try {
    const j = JSON.parse(v || "{}");
    const from = typeof j?.from === "string" && isWindowKey(j.from) ? j.from : "";
    const pilot = Array.isArray(j?.pilot)
      ? j.pilot.filter((x: unknown): x is string => typeof x === "string" && x.length > 0)
      : [];
    return { from, pilot };
  } catch {
    return { from: "", pilot: [] };
  }
}

/** 설정 원본 — DB 오류는 그대로 던진다(저장 경로용). */
export async function readRestrictConfig(): Promise<RestrictConfig> {
  const m = await prisma.appMeta.findUnique({ where: { key: RESTRICT_KEY } });
  if (!m) return OFF;
  const { from, pilot } = parseValue(m.value);
  return { on: true, from, pilot, changedAt: m.syncedAt };
}

/** 화면용 설정 — 한 요청 안에서는 한 번만 읽고, DB 오류면 꺼짐. */
export const getRestrictConfig = cache(async (): Promise<RestrictConfig> => {
  try {
    return await readRestrictConfig();
  } catch {
    return OFF;
  }
});

type UserLike = { id: string; role: string };

/** 이 지점·이 시각에 제한 모드가 적용되는가(순수 판정). */
export function restrictAppliesTo(
  cfg: RestrictConfig,
  user: UserLike | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!cfg.on || !user) return false;
  if (user.role !== "MERCHANT_HOTDEAL") return false;
  if (cfg.from && windowKeyAt(now) < cfg.from) return false;
  if (cfg.pilot.length > 0 && !cfg.pilot.includes(user.id)) return false;
  return true;
}

/** 이 지점의 '발주창 K' 가 제한 모드 대상인가(관리자 대리 수정처럼 지난·다른 창 발주를 다룰 때). */
export function restrictAppliesToWindow(
  cfg: RestrictConfig,
  user: UserLike | null | undefined,
  windowKey: string,
): boolean {
  if (!cfg.on || !user) return false;
  if (user.role !== "MERCHANT_HOTDEAL") return false;
  if (cfg.from && windowKey < cfg.from) return false;
  if (cfg.pilot.length > 0 && !cfg.pilot.includes(user.id)) return false;
  return true;
}

/** 화면 판정(실패하면 꺼짐). */
export async function restrictModeFor(
  user: UserLike | null | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  return restrictAppliesTo(await getRestrictConfig(), user, now);
}

/** 저장 판정(실패하면 예외). 발주 생성·수정·재고현황 담기 같은 쓰기 경로에서 사용. */
export async function restrictModeForStrict(
  user: UserLike | null | undefined,
  now: number = Date.now(),
): Promise<boolean> {
  return restrictAppliesTo(await readRestrictConfig(), user, now);
}

/**
 * 점주 메뉴 노출 — 재고현황·공산품(옛 예약발주). 주간발주는 항상 그대로.
 * · 재고현황 = 품목 제한 모드면 숨김.
 * · 공산품 = 지점 '공산품 노출'(reservationEnabled)만 본다. 제한 모드와 상관없이 보인다
 *   (2026-10-17~ 공구는 공산품으로만 받는다 — 제한 모드 지점은 일반발주에 공구가 없다).
 */
export async function merchantVisibility(
  user: (UserLike & { reservationEnabled?: boolean | null }) | null | undefined,
  now: number = Date.now(),
): Promise<{ restricted: boolean; inventory: boolean; reservations: boolean }> {
  const restricted = await restrictModeFor(user, now);
  return {
    restricted,
    inventory: !restricted,
    reservations: user?.reservationEnabled !== false,
  };
}

/** 관리자 저장 — 켜기(시작 창·시험 지점 포함) / 끄기. */
export async function setRestrictConfig(next: {
  on: boolean;
  from?: string;
  pilot?: string[];
}): Promise<void> {
  if (!next.on) {
    await prisma.appMeta.deleteMany({ where: { key: RESTRICT_KEY } });
    return;
  }
  const from = next.from && isWindowKey(next.from) ? next.from : "";
  const pilot = (next.pilot ?? []).filter((x) => typeof x === "string" && x.length > 0);
  const value = JSON.stringify({ from, pilot });
  await prisma.appMeta.upsert({
    where: { key: RESTRICT_KEY },
    create: { key: RESTRICT_KEY, value },
    update: { value, syncedAt: new Date() },
  });
}

/**
 * 화면이 그린 시점의 모드 표식 — 폼 hidden 으로 실어 보내고 서버가 다시 계산해 비교한다.
 * 다르면(그 사이 관리자가 켜고 끔·자정 넘김) '화면이 바뀌었어요. 새로고침해 주세요'로 거절.
 */
export function modeStamp(restricted: boolean, windowKey: string): string {
  return `${restricted ? "R" : "F"}:${windowKey}`;
}
