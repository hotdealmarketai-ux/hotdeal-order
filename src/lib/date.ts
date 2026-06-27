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

/** 하루 이동 (±1일) */
export function shiftDate(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00+09:00`);
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}
