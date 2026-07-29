// 창고관리 진입 게이트 공용 상수/헬퍼(서버 액션 파일이 아니라 값·함수 export 자유).
export const WAREHOUSE_UNLOCK_COOKIE = "wh_unlock";

// 창고관리는 PC 전용 — 모바일 UA면 막고 안내. 흔한 모바일 UA 토큰으로 판정.
export function isMobileUA(ua: string): boolean {
  return /Mobi|Android|iPhone|iPad|iPod|Opera Mini|IEMobile|BlackBerry/i.test(ua);
}
