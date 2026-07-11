// 핫딜마켓 가맹점 발주 운영시간 (주말 규칙 포함). 서버/클라이언트 공용 — 순수 날짜계산만.
//  - 월~금: 낮 12시 ~ 저녁 8시 발주 가능, 8시~다음날 12시 잠금
//  - 토요일 12시 ~ 일요일 20시: 연속 오픈(일요일 휴무라 한 번의 발주 창)
//  → 마감(20시)이 있는 날: 월·화·수·목·금·일
//  → 발주 재오픈(정오)이 있는 날: 월·화·수·목·금·토
const KST = 9 * 60 * 60 * 1000;

export const OPEN_HOUR = 12;
export const CLOSE_HOUR = 20;
export const ORDER_DEADLINE_LABEL = "오후 8시";
export const ORDER_OPEN_LABEL = "낮 12시";

function parts(now: number) {
  const d = new Date(now + KST);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth(),
    da: d.getUTCDate(),
    dow: d.getUTCDay(), // 0=일 ... 6=토
    h: d.getUTCHours(),
  };
}

// KST 벽시계 (y-mo-da h시) 에 해당하는 실제 UTC instant
function utcAt(y: number, mo: number, da: number, h: number) {
  return Date.UTC(y, mo, da, h, 0, 0) - KST;
}

/** 지금(KST) 발주 가능한 시간대인가 */
export function isOrderOpen(now: number = Date.now()): boolean {
  const { dow, h } = parts(now);
  if (dow === 6) return h >= OPEN_HOUR; // 토: 12시부터 계속(일요일까지)
  if (dow === 0) return h < CLOSE_HOUR; // 일: 20시까지
  return h >= OPEN_HOUR && h < CLOSE_HOUR; // 월~금
}

/** 현재 열린 창의 마감 instant (열려있다고 가정) */
export function currentDeadlineUtc(now: number = Date.now()): number {
  const { y, mo, da, dow } = parts(now);
  if (dow === 6) {
    // 토요일 → 마감은 내일(일) 20시
    const t = new Date(Date.UTC(y, mo, da) + 24 * 60 * 60 * 1000);
    return utcAt(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), CLOSE_HOUR);
  }
  return utcAt(y, mo, da, CLOSE_HOUR); // 월~금, 일 → 오늘 20시
}

/** 현재 열린 창의 시작 instant (열려있다고 가정) — '이번 창에 넣은 발주' 판별용 */
export function currentWindowStartUtc(now: number = Date.now()): number {
  const { y, mo, da, dow } = parts(now);
  if (dow === 0) {
    // 일요일 → 창 시작은 어제(토) 12시
    const t = new Date(Date.UTC(y, mo, da) - 24 * 60 * 60 * 1000);
    return utcAt(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), OPEN_HOUR);
  }
  return utcAt(y, mo, da, OPEN_HOUR);
}

/** 닫혀있을 때 다음 발주 시작(정오) instant */
export function nextOpenUtc(now: number = Date.now()): number {
  for (let i = 0; i < 8; i++) {
    const base = new Date(now + KST + i * 24 * 60 * 60 * 1000);
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth();
    const da = base.getUTCDate();
    const dow = base.getUTCDay();
    if (dow === 0) continue; // 일요일 정오엔 열리지 않음(토부터 연속이므로)
    const openInstant = utcAt(y, mo, da, OPEN_HOUR);
    if (openInstant > now) return openInstant;
  }
  return now;
}

// ============================================================
//  주간발주 창 — 매주 '토요일 12~20시' 딱 1회. 일일 발주창과 완전 독립.
// ============================================================
export const WEEKLY_DOW = 6; // 0=일 ... 6=토
export const WEEKLY_OPEN_LABEL = "매주 토요일 점심 12시";
export const WEEKLY_CLOSE_LABEL = "오후 8시";
const DAY = 24 * 60 * 60 * 1000;

/** 지금(KST) 주간발주 가능 시간대인가 — 토요일 12시~20시만 */
export function isWeeklyOpen(now: number = Date.now()): boolean {
  const { dow, h } = parts(now);
  return dow === WEEKLY_DOW && h >= OPEN_HOUR && h < CLOSE_HOUR;
}

/** 이번 주간 사이클 시작 instant = 가장 최근 '토요일 12시(KST)' ≤ now. 주(週) 식별 키의 기준. */
export function currentWeeklyWindowStartUtc(now: number = Date.now()): number {
  for (let i = 0; i < 8; i++) {
    const base = new Date(now + KST - i * DAY);
    if (base.getUTCDay() === WEEKLY_DOW) {
      const start = utcAt(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        OPEN_HOUR,
      );
      if (start <= now) return start;
    }
  }
  const { y, mo, da } = parts(now);
  return utcAt(y, mo, da, OPEN_HOUR); // 폴백(도달 불가)
}

/** 이번 주간창 마감 instant = 그 토요일 20시 */
export function currentWeeklyDeadlineUtc(now: number = Date.now()): number {
  const p = parts(currentWeeklyWindowStartUtc(now));
  return utcAt(p.y, p.mo, p.da, CLOSE_HOUR);
}

/** 다음 주간발주 오픈(토요일 12시) instant */
export function nextWeeklyOpenUtc(now: number = Date.now()): number {
  for (let i = 0; i < 8; i++) {
    const base = new Date(now + KST + i * DAY);
    if (base.getUTCDay() === WEEKLY_DOW) {
      const start = utcAt(
        base.getUTCFullYear(),
        base.getUTCMonth(),
        base.getUTCDate(),
        OPEN_HOUR,
      );
      if (start > now) return start;
    }
  }
  return now;
}
