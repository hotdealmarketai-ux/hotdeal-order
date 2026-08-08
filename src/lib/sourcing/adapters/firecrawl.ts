// Firecrawl 어댑터(유료). 검색+스크랩+LLM추출 API로 봇차단/렌더링을 대신 처리 → Vercel에서 바로 수집.
// 키: FIRECRAWL_API_KEY. (Track A=트렌드 리스트글에서 상호 추출 / Track B=쿠팡 베스트에서 제품 추출)
// ⚠ 라이브 응답에 맞춰 스키마/URL은 키 투입 후 소폭 조정 필요할 수 있음(계약은 v1 기준).
import type { LeadAdapter, ProductAdapter, RawLead, RawProduct, AdapterCtx } from "../types";
import { logError } from "@/lib/log";

const BASE = "https://api.firecrawl.dev/v1";
const key = () => process.env.FIRECRAWL_API_KEY || "";

async function fcSearch(query: string, limit = 5): Promise<string[]> {
  try {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, limit }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { url?: string }[] };
    return (j.data ?? []).map((d) => d.url || "").filter(Boolean);
  } catch (e) {
    logError("sourcing.fcSearch", e, { query });
    return [];
  }
}

// URL을 열어 스키마대로 구조화 추출(LLM). 실패 시 null.
async function fcExtract<T>(url: string, prompt: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/scrape`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ url, formats: ["json"], jsonOptions: { prompt } }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { json?: T } };
    return j.data?.json ?? null;
  } catch (e) {
    logError("sourcing.fcExtract", e, { url });
    return null;
  }
}

const LEAD_QUERIES = [
  "요즘 뜨는 수도권 디저트 맛집 웨이팅",
  "성수 연남 익선 신상 베이커리 인스타",
  "입소문 난 수제 떡집 서울 경기",
];

export const firecrawlLeadAdapter: LeadAdapter = {
  id: "firecrawl-lead",
  track: "LOCAL",
  enabled: () => !!key(),
  async run(ctx: AdapterCtx): Promise<RawLead[]> {
    const out: RawLead[] = [];
    for (const q of LEAD_QUERIES) {
      if (out.length >= ctx.limit) break;
      const urls = (await fcSearch(q, 4)).slice(0, 3);
      for (const url of urls) {
        if (out.length >= ctx.limit) break;
        const data = await fcExtract<{ shops?: { name?: string; region?: string; category?: string; instagram?: string; why?: string }[] }>(
          url,
          "이 글에서 소개하는 '프랜차이즈가 아닌' 개별 베이커리/디저트/떡집만 뽑아줘. 각 항목: name(상호), region(지역), category(베이커리|디저트|떡), instagram(있으면), why(왜 유명/뜨는지 한 줄). JSON.",
        );
        for (const s of data?.shops ?? []) {
          if (!s.name) continue;
          out.push({
            source: "firecrawl-lead",
            sourceRef: `${url}#${s.name}`,
            name: s.name,
            region: s.region || "",
            category: s.category || "",
            instagram: s.instagram || "",
            url,
            note: s.why || "",
          });
        }
      }
    }
    return out.slice(0, ctx.limit);
  },
};

// 쿠팡 베스트셀러(냉동/간편식) URL — env COUPANG_BEST_URLS로 지정하면 그 페이지를 직접 추출.
// 없으면 아래 검색어로 URL을 스스로 찾아 추출(Firecrawl 키만으로 동작).
const COUPANG_BEST_URLS = (process.env.COUPANG_BEST_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MEALKIT_QUERIES = [
  "쿠팡 냉동 간편식 밀키트 베스트셀러 인기순위",
  "스마트스토어 잘 팔리는 냉동 밀키트 국 탕 찌개",
  "요즘 인기 밀키트 냉동식품 순위",
];
async function gatherMealkitUrls(): Promise<string[]> {
  const urls: string[] = [];
  for (const q of MEALKIT_QUERIES) {
    urls.push(...(await fcSearch(q, 3)));
    if (urls.length >= 6) break;
  }
  return [...new Set(urls)].slice(0, 6);
}

export const firecrawlProductAdapter: ProductAdapter = {
  id: "firecrawl-product",
  track: "MEALKIT",
  enabled: () => !!key(),
  async run(ctx: AdapterCtx): Promise<RawProduct[]> {
    const out: RawProduct[] = [];
    const urls = COUPANG_BEST_URLS.length > 0 ? COUPANG_BEST_URLS : await gatherMealkitUrls();
    for (const url of urls) {
      if (out.length >= ctx.limit) break;
      const data = await fcExtract<{ products?: { name?: string; brand?: string; price?: number; reviewCount?: number; url?: string; imageUrl?: string }[] }>(
        url,
        "이 쿠팡 베스트셀러 목록의 상위 제품을 뽑아줘. 각 항목: name(제품명), brand(브랜드), price(숫자), reviewCount(리뷰수 숫자), url(상품링크), imageUrl. 냉동·냉장·밀키트·간편식 위주. JSON.",
      );
      for (const p of data?.products ?? []) {
        if (!p.name) continue;
        out.push({
          source: "firecrawl-product",
          sourceRef: p.url || p.name,
          name: p.name,
          brand: p.brand || "",
          price: typeof p.price === "number" ? p.price : null,
          reviewCount: typeof p.reviewCount === "number" ? p.reviewCount : null,
          url: p.url || url,
          imageUrl: p.imageUrl || "",
        });
      }
    }
    return out.slice(0, ctx.limit);
  },
};
