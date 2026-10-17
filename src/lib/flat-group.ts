// ============================================================
//  공산품 마감 묶음 — 점주·관리자 목록 공용(순수 함수, 클라이언트 부품에서도 가져다 쓴다 → prisma 금지).
//  · 점주가 지켜야 하는 건 '언제까지'라 마감 시각(분 단위로 같으면 한 묶음)으로 먼저 묶고, 그 안을 출고일로 나눈다.
//    (출고일로 먼저 묶으면 같은 금요일 출고 안에 월 마감·수 마감이 섞여 월 마감을 놓치기 쉽다.)
//  · 정렬 = 마감 임박순 → 출고일순 → ㄱㄴㄷ (마감된 목록은 최근 마감순)
//  · 묶음 머리: 묶음 안 상품의 최소·몇 개씩·안내가 모두 같으면 머리에 한 번만 보이게 그 값을 실어 준다.
//  검색·'발주한 것만'으로 거른 뒤에 묶으므로 빈 묶음은 생기지 않는다.
// ============================================================
import type { FlatQtyRule } from "@/lib/flat-qty-rule";

export type FlatShipGroup<T> = { pickupDate: string; items: T[] };
export type FlatCloseGroup<T> = {
  closeAtMs: number; // 묶음 마감 시각(분 단위로 같은 상품끼리)
  ships: FlatShipGroup<T>[]; // 출고일 오름차순, 그 안은 ㄱㄴㄷ
  commonRule: FlatQtyRule | null; // 묶음 안 최소·몇 개씩이 모두 같으면 그 값(다르면 null → 카드마다 표시)
  commonDesc: string | null; // 묶음 안 안내가 모두 같고 비어 있지 않으면 그 값(다르면 null)
};

// 규칙·안내 칸이 빠진 행(옛 매핑)은 '없음'(null·1·"")으로 본다.
export type FlatGroupable = {
  closeAtMs: number;
  pickupDate: string; // 출고일(= 계산서 날짜)
  name: string;
  minPerStore?: number | null;
  qtyStep?: number;
  description?: string;
};

/** 마감 시각 → 출고일 묶음. order: "asc" = 마감 임박순(진행 중), "desc" = 최근 마감순(마감된 목록). */
export function groupFlatByClose<T extends FlatGroupable>(
  rows: T[],
  order: "asc" | "desc" = "asc",
): FlatCloseGroup<T>[] {
  const byMinute = new Map<number, T[]>();
  for (const r of rows) {
    const key = Math.floor(r.closeAtMs / 60000);
    const list = byMinute.get(key);
    if (list) list.push(r);
    else byMinute.set(key, [r]);
  }
  const keys = [...byMinute.keys()].sort((a, b) => (order === "asc" ? a - b : b - a));
  return keys.map((key) => {
    const list = byMinute.get(key)!;
    const byShip = new Map<string, T[]>();
    for (const r of list) {
      const s = byShip.get(r.pickupDate);
      if (s) s.push(r);
      else byShip.set(r.pickupDate, [r]);
    }
    const ships = [...byShip.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([pickupDate, items]) => ({
        pickupDate,
        items: items.slice().sort((a, b) => a.name.localeCompare(b.name, "ko")),
      }));
    const min = (r: T) => r.minPerStore ?? null;
    const step = (r: T) => r.qtyStep ?? 1;
    const desc = (r: T) => r.description ?? "";
    const first = list[0];
    const sameRule = list.every((r) => min(r) === min(first) && step(r) === step(first));
    const sameDesc = list.every((r) => desc(r) === desc(first));
    return {
      closeAtMs: Math.min(...list.map((r) => r.closeAtMs)),
      ships,
      commonRule: sameRule ? { minPerStore: min(first), qtyStep: step(first) } : null,
      commonDesc: sameDesc && desc(first) ? desc(first) : null,
    };
  });
}

const DOW = ["일", "월", "화", "수", "목", "금", "토"];

/** 마감 시각 표시(KST) — "10월 19일 (월) 오전 10시" · "10월 21일 (수) 오후 2시 30분" (출고 날짜와 같은 꼴) */
export function closeAtLabel(ms: number): string {
  const d = new Date(ms + 9 * 3600 * 1000); // UTC 칸으로 읽으면 KST
  const h = d.getUTCHours();
  const m = d.getUTCMinutes();
  const ampm = h < 12 ? "오전" : "오후";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${DOW[d.getUTCDay()]}) ${ampm} ${h12}시${m ? ` ${m}분` : ""}`;
}

/**
 * 마감까지 남은 시간 — 묶음 제목에 한 번. tone: 24시간 안 'soon'(주황), 1시간 안 'urgent'(빨강), 지나면 'closed'.
 * "3일 4시간 남음" / "13시간 20분 남음" / "45분 10초 남음" / "마감됐어요"
 */
export function closeRemain(
  ms: number,
  now: number,
): { text: string; tone: "far" | "soon" | "urgent" | "closed" } {
  let s = Math.floor((ms - now) / 1000);
  if (s <= 0) return { text: "마감됐어요", tone: "closed" };
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return { text: `${d}일 ${h}시간 남음`, tone: "far" };
  if (h > 0) return { text: `${h}시간 ${m}분 남음`, tone: "soon" };
  return { text: `${m}분 ${s}초 남음`, tone: "urgent" };
}
