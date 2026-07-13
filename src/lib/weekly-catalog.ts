// 주간발주(항시품목) 카탈로그 — 주간발주최종 6.22.xlsx에서 추출.
// boxPrice = 박스(발주 1단위)당 공급가(원). 입금요청서 프리로드 단가로 쓰되 관리자가 수정 가능.
// ※ 단가는 원본 표를 기계 정리한 값이라, 발행 전 관리자 확인 권장(특히 봉/입 단위 품목).

export type WeeklyCategory = "SNACK" | "DAIRY" | "DRIED" | "EGG";

// #13 계란(EGG)은 박스/개가 아니라 판/구 단위.
export const boxWord = (cat: string) => (cat === "EGG" ? "판" : "박스");
export const pieceWord = (cat: string) => (cat === "EGG" ? "구" : "개");

export interface WeeklyItem {
  seq: string;
  category: WeeklyCategory;
  name: string;
  boxUnit: string; // 표시용(예: "50개", "1판 30개")
  boxPrice: number; // 박스당 공급가(원)
  minPrice?: number; // 최소판매가(참고)
}

export const WEEKLY_CATEGORIES: { key: WeeklyCategory; label: string }[] = [
  { key: "SNACK", label: "과자류" },
  { key: "DAIRY", label: "유제품" },
  { key: "DRIED", label: "건어물" },
  { key: "EGG", label: "계란" },
];

export const WEEKLY_CATALOG: WeeklyItem[] = [
  { seq: "S01", category: "SNACK", name: "달달맛밤", boxUnit: "50개", boxPrice: 36000, minPrice: 990 },
  { seq: "S02", category: "SNACK", name: "씬크레커", boxUnit: "8개", boxPrice: 23200, minPrice: 4900 },
  { seq: "S03", category: "SNACK", name: "나초", boxUnit: "12개", boxPrice: 21000, minPrice: 2300 },
  { seq: "S04", category: "SNACK", name: "꽃새우쌀과자", boxUnit: "16개", boxPrice: 38400, minPrice: 3900 },
  { seq: "S05", category: "SNACK", name: "어포빠삭이", boxUnit: "35개", boxPrice: 77000, minPrice: 3000 },
  { seq: "S06", category: "SNACK", name: "보리과자", boxUnit: "6개", boxPrice: 19200, minPrice: 4900 },
  { seq: "S07", category: "SNACK", name: "그시절김", boxUnit: "24", boxPrice: 72000 },
  { seq: "S08", category: "SNACK", name: "달콤쌀과자", boxUnit: "10개", boxPrice: 27000, minPrice: 3500 },
  { seq: "S09", category: "SNACK", name: "맛뻥", boxUnit: "12개", boxPrice: 34800, minPrice: 3500 },
  { seq: "S10", category: "SNACK", name: "약과", boxUnit: "200개", boxPrice: 60000, minPrice: 4900 },
  { seq: "S11", category: "SNACK", name: "고구마맛칩", boxUnit: "15개", boxPrice: 57000, minPrice: 4900 },
  { seq: "S12", category: "SNACK", name: "하몽크래커", boxUnit: "12개", boxPrice: 42000, minPrice: 4900 },
  { seq: "S13", category: "SNACK", name: "찹쌀누룽지", boxUnit: "14개", boxPrice: 39200, minPrice: 4900 },
  { seq: "S14", category: "SNACK", name: "약단밤", boxUnit: "25개", boxPrice: 225000 },
  { seq: "S15", category: "SNACK", name: "코코넛건빵", boxUnit: "30개", boxPrice: 90000 },
  { seq: "S16", category: "SNACK", name: "가마솥누룽지", boxUnit: "10개", boxPrice: 45000 },
  { seq: "S17", category: "SNACK", name: "하루콘", boxUnit: "20개", boxPrice: 56000, minPrice: 3900 },
  { seq: "S18", category: "SNACK", name: "AFC야채크래커", boxUnit: "16개", boxPrice: 14400, minPrice: 1200 },
  { seq: "S19", category: "SNACK", name: "한입 찐 자색고구마", boxUnit: "20개", boxPrice: 28000, minPrice: 1900 },
  { seq: "S20", category: "SNACK", name: "조 참깨 곡물과자", boxUnit: "8개", boxPrice: 38400, minPrice: 9000 },
  { seq: "S21", category: "SNACK", name: "오리지널 쌀과자", boxUnit: "14개", boxPrice: 22400, minPrice: 2500 },
  { seq: "S22", category: "SNACK", name: "고소한 쌀과자", boxUnit: "14개", boxPrice: 22400, minPrice: 2500 },
  { seq: "S23", category: "SNACK", name: "우리밀 마카로니", boxUnit: "18개", boxPrice: 41400, minPrice: 3000 },
  { seq: "S24", category: "SNACK", name: "국산옥수수로만든 강냉이요", boxUnit: "15개", boxPrice: 41250, minPrice: 3900 },
  { seq: "S25", category: "SNACK", name: "압구정 현대방앗간 참기름", boxUnit: "1개", boxPrice: 8500 },
  { seq: "S26", category: "SNACK", name: "압구정 현대방앗간 들기름", boxUnit: "1개", boxPrice: 13000 },
  { seq: "S27", category: "SNACK", name: "우거지청국장", boxUnit: "10개", boxPrice: 39700 },
  { seq: "D01", category: "DAIRY", name: "서울우유 나백 1L", boxUnit: "16", boxPrice: 38400, minPrice: 3000 },
  { seq: "D02", category: "DAIRY", name: "A2 플러스 710ML 우유", boxUnit: "10", boxPrice: 28000, minPrice: 3400 },
  { seq: "D03", category: "DAIRY", name: "커피포리 4입", boxUnit: "9", boxPrice: 30150, minPrice: 4200 },
  { seq: "D04", category: "DAIRY", name: "딸기우유 200ML", boxUnit: "50", boxPrice: 38500, minPrice: 1000 },
  { seq: "D05", category: "DAIRY", name: "초코우유 200ML", boxUnit: "50", boxPrice: 38500, minPrice: 1000 },
  { seq: "D06", category: "DAIRY", name: "커피우유 200ML", boxUnit: "50", boxPrice: 38500, minPrice: 1000 },
  { seq: "D07", category: "DAIRY", name: "딸기우유 300ML", boxUnit: "28", boxPrice: 33600, minPrice: 1500 },
  { seq: "D08", category: "DAIRY", name: "초코우유 300ML", boxUnit: "28", boxPrice: 33600, minPrice: 1500 },
  { seq: "D09", category: "DAIRY", name: "커피우유 300ML", boxUnit: "28", boxPrice: 33600, minPrice: 1500 },
  { seq: "D10", category: "DAIRY", name: "요구르트오리지널 750ml", boxUnit: "6", boxPrice: 11100, minPrice: 2400 },
  { seq: "D11", category: "DAIRY", name: "스타벅스컵커피 라떼 320ML", boxUnit: "10", boxPrice: 21000, minPrice: 2700 },
  { seq: "D12", category: "DAIRY", name: "스타벅스 카페라떼 200ML", boxUnit: "10", boxPrice: 15000, minPrice: 2000 },
  { seq: "D13", category: "DAIRY", name: "컵 커피포리 200", boxUnit: "10", boxPrice: 9800, minPrice: 1200 },
  { seq: "D14", category: "DAIRY", name: "비요뜨 초코링", boxUnit: "12", boxPrice: 12000, minPrice: 1300 },
  { seq: "D15", category: "DAIRY", name: "비요뜨 크런치볼", boxUnit: "12", boxPrice: 12000, minPrice: 1300 },
  { seq: "D16", category: "DAIRY", name: "비요뜨 쿠키앤크림", boxUnit: "12", boxPrice: 12000, minPrice: 1300 },
  { seq: "D17", category: "DAIRY", name: "비요뜨 베리콩포트", boxUnit: "12", boxPrice: 12000, minPrice: 1300 },
  { seq: "D18", category: "DAIRY", name: "짜요짜요 딸기 240g", boxUnit: "10", boxPrice: 18000, minPrice: 2300 },
  { seq: "D19", category: "DAIRY", name: "짜요짜요 포도 240g", boxUnit: "10", boxPrice: 18000, minPrice: 2300 },
  { seq: "D20", category: "DAIRY", name: "짜요짜요 복숭아 240g", boxUnit: "10", boxPrice: 18000, minPrice: 2300 },
  { seq: "D21", category: "DAIRY", name: "더진한 플레인 무가당 1L", boxUnit: "12", boxPrice: 37800, minPrice: 3980 },
  { seq: "D22", category: "DAIRY", name: "더진한 플레인 스위트 1L", boxUnit: "12", boxPrice: 37800, minPrice: 3980 },
  { seq: "D23", category: "DAIRY", name: "올데이프룻 오렌지 250ml", boxUnit: "10", boxPrice: 7600, minPrice: 1000 },
  { seq: "D24", category: "DAIRY", name: "올데이프룻 자두 250ml컵", boxUnit: "10", boxPrice: 7600, minPrice: 1000 },
  { seq: "D25", category: "DAIRY", name: "올데이프룻 청매실제로 250ml컵", boxUnit: "10", boxPrice: 7700, minPrice: 1000 },
  { seq: "D26", category: "DAIRY", name: "불가리스 그릭 알룰로스 400", boxUnit: "6", boxPrice: 13500, minPrice: 2900 },
  { seq: "D27", category: "DAIRY", name: "불가리스 그릭 무가당 400", boxUnit: "6", boxPrice: 13500, minPrice: 2900 },
  { seq: "D28", category: "DAIRY", name: "바나나맛우유 4입멀티", boxUnit: "8", boxPrice: 35200, minPrice: 4900 },
  { seq: "D29", category: "DAIRY", name: "바나나맛우유 무가당/딸기맛 4입멀티", boxUnit: "8", boxPrice: 35200, minPrice: 4900 },
  { seq: "D30", category: "DAIRY", name: "바나나맛우유 미니", boxUnit: "24", boxPrice: 21120, minPrice: 1100 },
  { seq: "D31", category: "DAIRY", name: "짜먹는 요플레키즈 딸기", boxUnit: "10", boxPrice: 20500, minPrice: 2600 },
  { seq: "D32", category: "DAIRY", name: "짜먹는 요플레키즈 포도", boxUnit: "10", boxPrice: 20500, minPrice: 2600 },
  { seq: "D33", category: "DAIRY", name: "요플레 딸기 4입", boxUnit: "8", boxPrice: 22000, minPrice: 3500 },
  { seq: "D34", category: "DAIRY", name: "요플레 복숭아 4입", boxUnit: "8", boxPrice: 22000, minPrice: 3500 },
  { seq: "D35", category: "DAIRY", name: "요플레 딸기 라이트 6입", boxUnit: "5", boxPrice: 13750, minPrice: 3500 },
  { seq: "D36", category: "DAIRY", name: "요플레 플레인 라이트 6입", boxUnit: "5", boxPrice: 13750, minPrice: 3500 },
  { seq: "D37", category: "DAIRY", name: "요플레 샤인머스캣 라이트 6입", boxUnit: "5", boxPrice: 13750, minPrice: 3500 },
  { seq: "D38", category: "DAIRY", name: "요플레플레인화이트 430g", boxUnit: "6", boxPrice: 15900, minPrice: 3300 },
  { seq: "D39", category: "DAIRY", name: "바이오플레 8입", boxUnit: "4", boxPrice: 9000, minPrice: 2900 },
  { seq: "D40", category: "DAIRY", name: "빙그레 오늘의커피", boxUnit: "10", boxPrice: 9300, minPrice: 1200 },
  { seq: "D41", category: "DAIRY", name: "매일허쉬 235ml (4입)", boxUnit: "32", boxPrice: 105600, minPrice: 4200 },
  { seq: "D42", category: "DAIRY", name: "매일앤요 봉지 (10입)", boxUnit: "7", boxPrice: 17500, minPrice: 3200 },
  { seq: "D43", category: "DAIRY", name: "매일바이오그릭 400g", boxUnit: "6", boxPrice: 21000, minPrice: 4200 },
  { seq: "D44", category: "DAIRY", name: "원데이 바리스타 1L", boxUnit: "12", boxPrice: 18600, minPrice: 2000 },
  { seq: "D45", category: "DAIRY", name: "바리스타 오르조(디카페인) 1L", boxUnit: "12", boxPrice: 18600, minPrice: 2000 },
  { seq: "D46", category: "DAIRY", name: "상하 유기농 우유 900", boxUnit: "12", boxPrice: 38400, minPrice: 3900 },
  { seq: "R01", category: "DRIED", name: "꽃보다 오징어", boxUnit: "50개", boxPrice: 430000, minPrice: 10900 },
  { seq: "R02", category: "DRIED", name: "구운쥐포", boxUnit: "100개", boxPrice: 220000, minPrice: 3200 },
  { seq: "R03", category: "DRIED", name: "단짠오징어스틱", boxUnit: "50개", boxPrice: 325000, minPrice: 7900 },
  { seq: "R04", category: "DRIED", name: "구운꼬마쥐포", boxUnit: "100", boxPrice: 220000, minPrice: 3200 },
  { seq: "R05", category: "DRIED", name: "우거지청국장", boxUnit: "50", boxPrice: 187000, minPrice: 4900 },
  { seq: "E01", category: "EGG", name: "난각 1번 특란", boxUnit: "1판 30개", boxPrice: 11500, minPrice: 14000 },
  { seq: "E02", category: "EGG", name: "난각 2번 특란", boxUnit: "1판 30개", boxPrice: 10000, minPrice: 12000 },
  { seq: "E03", category: "EGG", name: "난각 1번 초란", boxUnit: "1판 30개", boxPrice: 9000, minPrice: 11500 },
  { seq: "E04", category: "EGG", name: "훈제란", boxUnit: "1박스20개", boxPrice: 58000, minPrice: 3500 },
];

export const WEEKLY_BY_SEQ: Record<string, WeeklyItem> = Object.fromEntries(
  WEEKLY_CATALOG.map((it) => [it.seq, it]),
);
