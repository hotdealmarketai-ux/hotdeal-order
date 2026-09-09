// [임시·1회용] 관리자 요청 재고 임의 차감 — 변경 기록/감사 로그 없이 수량만 차감.
// 사용 후 이 파일과 액션·페이지를 함께 제거한다.
import { prisma } from "@/lib/prisma";

// 차감 대상(품목명 기준) — 이름은 정규화(공백 제거) 매칭.
export const ADJUST_ONCE_TARGETS: { name: string; deduct: number }[] = [
  { name: "블랙 트러플 하몽소다 크래커 294g", deduct: 12 },
  { name: "매콤 양념 돼지껍데기", deduct: 9 },
  { name: "돈목살 대패", deduct: 6 },
];

const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export type AdjustStatus = "ok" | "not_found" | "ambiguous" | "negative";
export type ResolvedTarget = {
  target: { name: string; deduct: number };
  itemId: string | null;
  matchedName: string | null;
  currentQty: number | null;
  afterQty: number | null;
  status: AdjustStatus;
  candidates: string[];
};

// 현재 재고에서 대상 품목을 찾아 차감 후 예상 수량까지 계산(읽기 전용).
export async function resolveAdjustOnce(): Promise<ResolvedTarget[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, qty: true },
  });
  return ADJUST_ONCE_TARGETS.map((t) => {
    const tn = norm(t.name);
    let matches = items.filter((it) => norm(it.name) === tn); // 1순위: 정확 일치
    if (matches.length === 0) matches = items.filter((it) => norm(it.name).includes(tn)); // 2순위: 포함(유일할 때만 인정)
    if (matches.length === 0)
      return { target: t, itemId: null, matchedName: null, currentQty: null, afterQty: null, status: "not_found", candidates: [] };
    if (matches.length > 1)
      return { target: t, itemId: null, matchedName: null, currentQty: null, afterQty: null, status: "ambiguous", candidates: matches.map((m) => m.name) };
    const m = matches[0];
    const after = m.qty - t.deduct;
    return {
      target: t,
      itemId: m.id,
      matchedName: m.name,
      currentQty: m.qty,
      afterQty: after,
      status: after < 0 ? "negative" : "ok",
      candidates: [],
    };
  });
}
