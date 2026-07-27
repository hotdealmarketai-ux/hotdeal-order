// 한국시간(KST, UTC+9) 기준 날짜 처리 — 서버 타임존과 무관하게 정확

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 오늘 날짜(KST) YYYY-MM-DD */
export function kstToday(): string {
  return new Date(Date.now() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 특정 인스턴트가 속한 KST 날짜 YYYY-MM-DD */
export function kstDateOf(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(date.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/** YYYY-MM-DD(KST) 형식 + 실제 존재하는 날짜인지 검증 + 보정. 잘못되면 오늘로. */
export function normalizeDateStr(s?: string | null): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) {
    // 형식만 맞고 달력상 불가능한 날짜(2026-02-30 등)는 Date가 조용히 다음 달로 롤오버한다.
    // 왕복 확인(kstDateOf(parsed) === s)으로 실제 존재하는 날짜만 통과시킨다.
    const d = new Date(`${s}T00:00:00+09:00`);
    if (!Number.isNaN(d.getTime()) && kstDateOf(d) === s) return s;
  }
  return kstToday();
}

/** KST 날짜의 [시작, 끝) UTC 인스턴트 (createdAt 범위 필터용) */
export function kstDayRange(dateStr: string): { start: Date; end: Date } {
  const start = new Date(`${dateStr}T00:00:00+09:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** 표시용: YYYY-MM-DD -> "6월 26일 (금)" */
export function labelDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
    timeZone: "Asia/Seoul",
  }).format(d);
}

/** 표시용: YYYY-MM-DD -> "7월 15일 수요일" (연도 없이, 요일 전체) */
export function labelDateLong(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(d);
}

/** 표시용 풀 라벨: YYYY-MM-DD -> "2026년 6월 27일 토요일" */
export function fullKLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
    timeZone: "Asia/Seoul",
  }).format(d);
}

/** 하루 이동 (±1일) — KST 기준으로 정확히(이전엔 UTC 슬라이스라 +1이 안 먹던 버그) */
export function shiftDate(dateStr: string, days: number): string {
  const base = new Date(`${dateStr}T00:00:00+09:00`).getTime() + days * 24 * 60 * 60 * 1000;
  return kstDateOf(new Date(base));
}

/** YYYY-MM-DD(KST)의 요일 (0=일 … 6=토) */
export function dowOf(dateStr: string): number {
  return new Date(`${dateStr}T00:00:00Z`).getUTCDay();
}

/**
 * 출고일(물건 챙기는/출고하는 날) = 발주일 + 1일.
 * 단 일요일은 휴무라, 토요일·일요일 발주는 '다음 월요일'로 묶어서 본다.
 *   월~목 발주 → 다음날(화~금) / 금 발주 → 토 / 토 발주 → 월 / 일 발주 → 월
 * (즉 발주+1이 일요일이면 하루 더 밀어 월요일로)
 */
export function shipmentDayOf(orderDateKst: string): string {
  const next = shiftDate(orderDateKst, 1);
  return dowOf(next) === 0 ? shiftDate(orderDateKst, 2) : next;
}

/**
 * 출고일 → 그 출고일에 실린 '발주일'들의 createdAt 범위 [start, end).
 *   월요일 출고 = 토·일 발주 2일치 / 그 외 = 출고 전날 하루.
 * (shipmentDayOf의 역함수. 목록이 출고일로 묶여도 상세는 원래 발주 범위로 조회되게.)
 */
export function orderRangeForShipment(shipmentDayKst: string): { start: Date; end: Date } {
  if (dowOf(shipmentDayKst) === 1) {
    // 월요일 출고 ← 토요일·일요일 발주
    const sat = shiftDate(shipmentDayKst, -2);
    const sun = shiftDate(shipmentDayKst, -1);
    return { start: kstDayRange(sat).start, end: kstDayRange(sun).end };
  }
  return kstDayRange(shiftDate(shipmentDayKst, -1));
}
