// Firecrawl 어댑터(유료·v2). 검색+스크랩+LLM추출로 봇차단/렌더링을 대신 처리 → Vercel에서 바로 수집.
// 키: FIRECRAWL_API_KEY. Track A=트렌드 리스트글에서 상호 추출 / Track B=쿠팡·검색에서 밀키트 제품 추출.
// v2 계약: /v2/search(scrapeOptions로 결과 페이지 추출까지 1콜), /v2/scrape(formats:[{type:"json",prompt}]) → data.json.
import type { LeadAdapter, ProductAdapter, RawLead, RawProduct, AdapterCtx } from "../types";
import { logError } from "@/lib/log";

const BASE = "https://api.firecrawl.dev/v2";
const key = () => process.env.FIRECRAWL_API_KEY || "";
const headers = () => ({ Authorization: `Bearer ${key()}`, "Content-Type": "application/json" });

// 검색 + 각 결과 페이지에서 prompt대로 구조화 추출(1콜). [{url, json}] 반환.
async function fcSearchJson<T>(query: string, prompt: string, limit = 4): Promise<{ url: string; json: T }[]> {
  try {
    const res = await fetch(`${BASE}/search`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        query,
        limit,
        sources: [{ type: "web" }],
        scrapeOptions: { formats: [{ type: "json", prompt }] },
      }),
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j = (await res.json()) as { data?: { web?: { url?: string; json?: T }[] } };
    return (j.data?.web ?? [])
      .filter((w) => w.json)
      .map((w) => ({ url: w.url || "", json: w.json as T }));
  } catch (e) {
    logError("sourcing.fcSearchJson", e, { query });
    return [];
  }
}

// URL 하나를 열어 prompt대로 구조화 추출. 실패 시 null.
async function fcScrapeJson<T>(url: string, prompt: string): Promise<T | null> {
  try {
    const res = await fetch(`${BASE}/scrape`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ url, formats: [{ type: "json", prompt }] }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { data?: { json?: T } };
    return j.data?.json ?? null;
  } catch (e) {
    logError("sourcing.fcScrapeJson", e, { url });
    return null;
  }
}

// ── Track A: 로컬 업체 발굴 ──
const LEAD_QUERIES = [
  "오픈런 웨이팅 디저트 맛집 수도권",
  "품절대란 인스타 화제 베이커리 서울 경기",
  "요즘 난리난 수제 떡 디저트 전문점",
  "성수 연남 익선 망원 신상 베이커리 추천",
  "줄서서 먹는 빵집 디저트 수도권",
  "입소문 웨이팅 떡집 서울 경기 유명",
];
const LEAD_PROMPT =
  "이 페이지가 소개하는 '개별' 베이커리/디저트/떡집을 뽑아 JSON으로: " +
  "{shops:[{name(상호), region(지역/동네), category(베이커리|디저트|떡 중 하나), instagram(있으면 URL), why(왜 유명/뜨는지 한 줄)}]}. " +
  "대형 프랜차이즈 체인·대형마트는 제외.";

type LeadShape = { shops?: { name?: string; region?: string; category?: string; instagram?: string; why?: string }[] };

export const firecrawlLeadAdapter: LeadAdapter = {
  id: "firecrawl-lead",
  track: "LOCAL",
  enabled: () => !!key(),
  async run(ctx: AdapterCtx): Promise<RawLead[]> {
    const out: RawLead[] = [];
    for (const q of LEAD_QUERIES) {
      if (out.length >= ctx.limit) break;
      const results = await fcSearchJson<LeadShape>(q, LEAD_PROMPT, 5);
      for (const r of results) {
        for (const s of r.json?.shops ?? []) {
          if (!s.name) continue;
          out.push({
            source: "firecrawl-lead",
            sourceRef: `${r.url}#${s.name}`,
            name: s.name,
            region: s.region || "",
            category: s.category || "",
            instagram: s.instagram || "",
            url: r.url,
            note: s.why || "",
          });
          if (out.length >= ctx.limit) break;
        }
      }
    }
    return out.slice(0, ctx.limit);
  },
};

// ── Track B: 밀키트/냉동 ──
// COUPANG_BEST_URLS 지정하면 그 베스트 페이지 직접 추출, 없으면 검색으로.
const COUPANG_BEST_URLS = (process.env.COUPANG_BEST_URLS || "").split(",").map((s) => s.trim()).filter(Boolean);
const MEALKIT_QUERIES = [
  "쿠팡 냉동 간편식 밀키트 베스트셀러 판매량 순위",
  "품절대란 리뷰폭발 밀키트 냉동식품",
  "스마트스토어 잘 팔리는 냉동 국 탕 찌개 밀키트",
  "요즘 인기 급상승 밀키트 순위 후기",
];
const PRODUCT_PROMPT =
  "이 페이지의 냉동·냉장·밀키트·간편식 인기 제품을 뽑아 JSON으로: " +
  "{products:[{name(제품명), brand(브랜드), price(숫자만), reviewCount(리뷰수 숫자), url(상품링크), imageUrl}]}.";

type ProductShape = { products?: { name?: string; brand?: string; price?: number; reviewCount?: number; url?: string; imageUrl?: string }[] };

function pushProducts(out: RawProduct[], data: ProductShape | null, fallbackUrl: string, limit: number) {
  for (const p of data?.products ?? []) {
    if (out.length >= limit) return;
    if (!p.name) continue;
    out.push({
      source: "firecrawl-product",
      sourceRef: p.url || p.name,
      name: p.name,
      brand: p.brand || "",
      price: typeof p.price === "number" ? p.price : null,
      reviewCount: typeof p.reviewCount === "number" ? p.reviewCount : null,
      url: p.url || fallbackUrl,
      imageUrl: p.imageUrl || "",
    });
  }
}

export const firecrawlProductAdapter: ProductAdapter = {
  id: "firecrawl-product",
  track: "MEALKIT",
  enabled: () => !!key(),
  async run(ctx: AdapterCtx): Promise<RawProduct[]> {
    const out: RawProduct[] = [];
    if (COUPANG_BEST_URLS.length > 0) {
      for (const url of COUPANG_BEST_URLS) {
        if (out.length >= ctx.limit) break;
        pushProducts(out, await fcScrapeJson<ProductShape>(url, PRODUCT_PROMPT), url, ctx.limit);
      }
    } else {
      for (const q of MEALKIT_QUERIES) {
        if (out.length >= ctx.limit) break;
        const results = await fcSearchJson<ProductShape>(q, PRODUCT_PROMPT, 4);
        for (const r of results) pushProducts(out, r.json, r.url, ctx.limit);
      }
    }
    return out.slice(0, ctx.limit);
  },
};
