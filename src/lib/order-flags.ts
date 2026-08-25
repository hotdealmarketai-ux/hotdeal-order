// ============================================================
//  일반 발주 관리 — 발주 방식(칸/채팅) on/off + 과일/야채 품목 고정
//  · 4개 스위치는 AppMeta presence 플래그(키 존재 = 켜짐). maintenance.ts 패턴.
//  · 고정 품목 목록은 FixedOrderItem(DB, 관리자 편집).
//  · DB 장애 시 모든 get 은 '기능 정상(막지 않음)'으로 폴백 → 발주 흐름 보호.
// ============================================================

import { prisma } from "@/lib/prisma";
import type { Category } from "@/lib/constants";

const KEY = {
  gridOff: "order_grid_off",
  chatOff: "order_chat_off",
  fixedFruit: "order_fixed_fruit",
  fixedVeg: "order_fixed_veg",
} as const;

export type OrderFlagKey = keyof typeof KEY;
export const ORDER_FLAG_KEYS: OrderFlagKey[] = [
  "gridOff",
  "chatOff",
  "fixedFruit",
  "fixedVeg",
];

async function flagOn(k: OrderFlagKey): Promise<boolean> {
  try {
    const m = await prisma.appMeta.findUnique({ where: { key: KEY[k] } });
    return !!m;
  } catch {
    return false; // DB 장애 → 플래그 꺼짐으로 간주(발주 정상 노출)
  }
}

export async function setOrderFlag(k: OrderFlagKey, on: boolean): Promise<void> {
  if (on) {
    await prisma.appMeta.upsert({
      where: { key: KEY[k] },
      create: { key: KEY[k] },
      update: { syncedAt: new Date() },
    });
  } else {
    await prisma.appMeta.deleteMany({ where: { key: KEY[k] } });
  }
}

export type OrderChannelConfig = {
  gridOff: boolean;
  chatOff: boolean;
  fixedFruit: boolean;
  fixedVeg: boolean;
};

/** 4개 스위치 원본값(관리자 화면 표시용). */
export async function orderChannelConfig(): Promise<OrderChannelConfig> {
  const [gridOff, chatOff, fixedFruit, fixedVeg] = await Promise.all([
    flagOn("gridOff"),
    flagOn("chatOff"),
    flagOn("fixedFruit"),
    flagOn("fixedVeg"),
  ]);
  return { gridOff, chatOff, fixedFruit, fixedVeg };
}

/**
 * 실제 가맹점에 적용될 유효 채널 상태(순수 함수).
 * 불변식:
 *  - 품목 고정이 하나라도 켜지면 채팅 발주는 잠긴다(자유 품목명이 고정과 충돌).
 *  - 품목 고정이 켜지면 칸 발주는 반드시 열려 있어야 한다(고정 품목을 칸으로 입력).
 *  - 칸/채팅이 동시에 잠기는 모순 상태는 칸을 열어 방지(가맹점이 발주 불가가 되면 안 됨).
 */
export function effectiveChannels(cfg: OrderChannelConfig): {
  gridDisabled: boolean;
  chatDisabled: boolean;
} {
  const anyFixed = cfg.fixedFruit || cfg.fixedVeg;
  let gridDisabled = cfg.gridOff;
  let chatDisabled = cfg.chatOff || anyFixed;
  if (anyFixed) gridDisabled = false; // 고정 품목 입력 경로 보장
  if (gridDisabled && chatDisabled) gridDisabled = false; // 둘 다 잠김 방지
  return { gridDisabled, chatDisabled };
}

/** 해당 카테고리가 '품목 고정' 상태인지(FRUIT/VEG 만 대상). */
export function isFixedCategory(cat: Category, cfg: OrderChannelConfig): boolean {
  return (
    (cat === "FRUIT" && cfg.fixedFruit) || (cat === "VEG" && cfg.fixedVeg)
  );
}

export type FixedItem = { id: string; name: string };
export type FixedItemsByCat = { FRUIT: FixedItem[]; VEG: FixedItem[] };

/** 고정 품목 목록(카테고리별, sortOrder 순). activeOnly=true 면 노출 품목만. */
export async function fixedItemsByCat(
  activeOnly: boolean,
): Promise<FixedItemsByCat> {
  const out: FixedItemsByCat = { FRUIT: [], VEG: [] };
  try {
    const rows = await prisma.fixedOrderItem.findMany({
      where: activeOnly ? { active: true } : {},
      orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, name: true, category: true, active: true, sortOrder: true },
    });
    for (const r of rows) {
      if (r.category === "FRUIT") out.FRUIT.push({ id: r.id, name: r.name });
      else if (r.category === "VEG") out.VEG.push({ id: r.id, name: r.name });
    }
  } catch {
    // DB 장애 → 빈 목록(호출부에서 고정 품목 없음으로 처리)
  }
  return out;
}

/** 화이트리스트 비교용 이름 정규화(공백 접기·트림). */
export function normFixedName(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

/** 서버 저장 게이트용 — 카테고리별 '노출 고정 품목명' 집합(정규화). */
export async function fixedNameSets(): Promise<Record<"FRUIT" | "VEG", Set<string>>> {
  const items = await fixedItemsByCat(true);
  return {
    FRUIT: new Set(items.FRUIT.map((i) => normFixedName(i.name))),
    VEG: new Set(items.VEG.map((i) => normFixedName(i.name))),
  };
}
