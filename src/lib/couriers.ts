// 택배사 목록 + 송장 상태 — 순수 데이터(클라이언트에서도 import 안전, process.env/fetch 없음).
// 코드는 스마트택배(SweetTracker) t_code 기준.

export const COURIERS: { code: string; name: string }[] = [
  { code: "04", name: "CJ대한통운" },
  { code: "01", name: "우체국택배" },
  { code: "05", name: "한진택배" },
  { code: "08", name: "롯데택배" },
  { code: "06", name: "로젠택배" },
  { code: "23", name: "경동택배" },
  { code: "22", name: "대신택배" },
  { code: "46", name: "CU 편의점택배" },
  { code: "24", name: "GS Postbox 택배" },
  { code: "11", name: "일양로지스" },
  { code: "56", name: "한덱스" },
  { code: "16", name: "한의사랑택배" },
];

export function courierName(code: string): string {
  return COURIERS.find((c) => c.code === code)?.name ?? code;
}

export type ShipmentStatus =
  | "PRE_PICKUP" // 집하전
  | "READY" // 배송 준비중
  | "IN_TRANSIT" // 배송 중
  | "DELIVERED" // 배송 완료
  | "ERROR"; // 조회 실패

export const STATUS_LABEL: Record<ShipmentStatus, string> = {
  PRE_PICKUP: "집하전",
  READY: "배송 준비중",
  IN_TRANSIT: "배송 중",
  DELIVERED: "배송 완료",
  ERROR: "조회 실패",
};

// 4개 섹션 표시 순서. ERROR는 '집하전' 섹션에 함께 묶어 보여준다(조회 안된 것 = 아직 집하 전 취급).
export const STATUS_ORDER: ShipmentStatus[] = [
  "PRE_PICKUP",
  "READY",
  "IN_TRANSIT",
  "DELIVERED",
];
