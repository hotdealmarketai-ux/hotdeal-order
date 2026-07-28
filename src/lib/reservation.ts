// 예약발주 순수 계산(마감/로드일/검증/라벨/상태) — prisma 미의존, 클라이언트 컴포넌트도 import 가능.
// 서버 데이터 접근(prisma 쿼리)은 actions/reservation.ts 에 둔다(주간발주 schedule/weekly 분리 패턴).
import { shiftDate, labelDate } from "@/lib/date";

// 예약 마감 = 예약일자가 속한 '일반발주 창'의 마감(저녁 8시). 일반발주와 함께 20시에 취합.
//  - 월~금·일: 그날 20:00 KST
//  - 토요일: 주말 연속창(토12~일20)이라 다음날(일) 20:00
export function reservationDeadlineUtc(reserveDate: string): Date {
  const dow = new Date(`${reserveDate}T00:00:00Z`).getUTCDay(); // 그 캘린더 날짜의 요일(0=일..6=토)
  const closeDate = dow === 6 ? shiftDate(reserveDate, 1) : reserveDate;
  return new Date(`${closeDate}T20:00:00+09:00`);
}

// 공구 자동로드일(= 픽업 전날) KST YYYY-MM-DD — 그날 발주창 공구에 읽기전용으로 뜬다.
export function reservationLoadDate(pickupDate: string): string {
  return shiftDate(pickupDate, -1);
}

// 지금 예약이 마감됐는가(예약일자+1 12:00 지남)
export function isReservationClosed(reserveDate: string, now: number = Date.now()): boolean {
  return now >= reservationDeadlineUtc(reserveDate).getTime();
}

// KST 자정 기준 두 날짜(YYYY-MM-DD) 사이 일수 = a - b
export function daysBetween(a: string, b: string): number {
  const ta = new Date(`${a}T00:00:00+09:00`).getTime();
  const tb = new Date(`${b}T00:00:00+09:00`).getTime();
  return Math.round((ta - tb) / 86_400_000);
}

// 관리자 등록 검증 — 픽업일자는 예약일자보다 최소 하루 뒤(다음날 픽업 허용).
// 마감(예약일 20시) 당일 발주창(=픽업 전날)에 로드되므로 픽업 = 예약+1도 가능해졌다.
export function validateBatchDates(
  reserveDate: string,
  pickupDate: string,
): { ok: boolean; error?: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(reserveDate)) return { ok: false, error: "예약일자를 선택하세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate)) return { ok: false, error: "픽업일자를 선택하세요." };
  if (daysBetween(pickupDate, reserveDate) < 1) {
    return {
      ok: false,
      error: "픽업일자는 예약일자보다 뒤여야 합니다(빠르면 다음날).",
    };
  }
  return { ok: true };
}

// 마감 카운트다운/안내 라벨: "7월 21일 (월) 저녁 8시" (토요일 예약은 일요일 20시)
export function reservationDeadlineLabel(reserveDate: string): string {
  const dow = new Date(`${reserveDate}T00:00:00Z`).getUTCDay();
  const closeDate = dow === 6 ? shiftDate(reserveDate, 1) : reserveDate;
  return `${labelDate(closeDate)} 저녁 8시`;
}

// 상태 배지 + 편집잠금 판정(점주/관리자 공용)
// - 마감 후: 무조건 잠금.
// - 마감 전 + 확정: 잠금(수정 누르면 해제).
// - 마감 전 + 미확정: 열림(입력 가능).
// reservedQty = 내가 예약한 총 수량(연동+수기). 0이면 '예약 중'이 아니라 '예약 가능'으로 표시.
export function reservationStatusOf(
  order: { confirmed: boolean } | null,
  reserveDate: string,
  now: number = Date.now(),
  reservedQty: number = 0,
): { label: string; cls: string; locked: boolean } {
  const has = reservedQty > 0;
  if (isReservationClosed(reserveDate, now)) {
    return order?.confirmed && has
      ? { label: "예약 확정", cls: "badge--ok", locked: true }
      : { label: "예약 마감", cls: "badge--danger", locked: true };
  }
  if (order?.confirmed && has) return { label: "확정됨", cls: "badge--ai", locked: true };
  // 담은 게 없으면 '예약 중'이 아니라 '예약 가능'(사용자 요청 — 다 0이면 예약 중 풀림).
  if (!has) return { label: "예약 가능", cls: "badge--mute", locked: false };
  return { label: "예약 중", cls: "badge--wait", locked: false };
}
