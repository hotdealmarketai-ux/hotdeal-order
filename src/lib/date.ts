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

/** YYYY-MM-DD(KST) 형식 검증 + 보정. 잘못되면 오늘로. */
export function normalizeDateStr(s?: string | null): string {
  if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
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
