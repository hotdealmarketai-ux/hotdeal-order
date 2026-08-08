// 소싱 필터 — 프랜차이즈(로컬 발굴 제외) / 대기업 CPG(밀키트 제외) 블록리스트 + 판정 휴리스틱.
// ⚠ 리스트는 시작값. 관리자 판단으로 계속 다듬는다(오탐 시 여기 조정).

// 로컬 발굴에서 제외할 건 '공구 대상이 아닌 노이즈'뿐 — 대형 프랜차이즈 체인·대형마트만.
// ⚠ 유명·인기 전문점(자연도소금빵·런던베이글·노티드 등)은 제외하지 않는다. 납품 여부는 직접 컨택해 확인.
export const FRANCHISE_BLOCKLIST = [
  "파리바게뜨", "뚜레쥬르", "던킨", "크리스피크림", "베스킨라빈스", "배스킨라빈스",
  "설빙", "공차", "투썸플레이스", "폴바셋", "스타벅스", "이디야", "메가커피", "빽다방",
  "홈플러스", "이마트", "롯데마트", "코스트코", "노브랜드",
];

// 밀키트/냉동에서 제외할 대기업 CPG 브랜드 — 이미 어디서나 최저가라 가격 메리트 없음.
export const BIGBRAND_BLOCKLIST = [
  "비비고", "cj", "씨제이", "제일제당", "팔도", "오뚜기", "농심", "삼양", "풀무원",
  "청정원", "대상", "동원", "사조", "하림", "롯데", "오리온", "해태", "빙그레",
  "남양", "매일", "샘표", "백설", "해찬들", "종가집", "hy", "한국야쿠르트",
];

const lower = (s: string) => s.toLowerCase().replace(/\s+/g, "");

// 대형 프랜차이즈 체인·마트만 제외. '몇 호점' 여부로는 거르지 않는다(1~2호점 전문점이 대상이므로).
export function isFranchiseName(name: string): boolean {
  const n = lower(name);
  return FRANCHISE_BLOCKLIST.some((b) => n.includes(lower(b)));
}

export function isBigBrand(nameOrBrand: string): boolean {
  const n = lower(nameOrBrand);
  return BIGBRAND_BLOCKLIST.some((b) => n.includes(lower(b)));
}

// 밀키트 카테고리 추정(냉동/냉장/밀키트/간편식만 통과) — 명백히 무관한 건 거른다.
const MEALKIT_HINTS = [
  "밀키트", "간편식", "냉동", "냉장", "가정간편식", "hmr", "국", "탕", "찌개", "전골",
  "볶음", "구이", "튀김", "만두", "돈까스", "돈가스", "함박", "스테이크", "떡볶이",
  "곱창", "막창", "닭", "삼겹", "갈비", "곰탕", "육개장", "파스타", "리조또", "덮밥",
];
export function looksLikeMealkit(name: string, category = ""): boolean {
  const hay = lower(name + category);
  return MEALKIT_HINTS.some((h) => hay.includes(lower(h)));
}
