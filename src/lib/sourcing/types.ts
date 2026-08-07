// 상품 소싱 — 공통 타입 + 어댑터 인터페이스.
// 어댑터 = 하나의 소스(네이버 지역검색·Firecrawl 등). enabled()가 true(키 있음)일 때만 실행.
export type Track = "LOCAL" | "MEALKIT";

// 정규화된 로컬 업체 후보(Track A)
export type RawLead = {
  source: string;
  sourceRef?: string;
  name: string;
  region?: string;
  category?: string; // 베이커리 | 디저트 | 떡
  storeCount?: number | null;
  reviewCount?: number | null;
  instagram?: string;
  phone?: string;
  url?: string;
  note?: string;
};

// 정규화된 밀키트/냉동 제품 후보(Track B)
export type RawProduct = {
  source: string;
  sourceRef?: string;
  name: string;
  brand?: string;
  category?: string;
  price?: number | null;
  reviewCount?: number | null;
  url?: string;
  imageUrl?: string;
  note?: string;
};

export type AdapterCtx = { limit: number };

export type LeadAdapter = {
  id: string;
  track: "LOCAL";
  enabled(): boolean;
  run(ctx: AdapterCtx): Promise<RawLead[]>;
};
export type ProductAdapter = {
  id: string;
  track: "MEALKIT";
  enabled(): boolean;
  run(ctx: AdapterCtx): Promise<RawProduct[]>;
};
