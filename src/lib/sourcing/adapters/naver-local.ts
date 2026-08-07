// 네이버 지역검색 API 어댑터(Track A·무료). 상호·주소·카테고리·전화 → 로컬 후보.
// 키: NAVER_CLIENT_ID / NAVER_CLIENT_SECRET (네이버 개발자센터 앱, 무료). sort=comment=리뷰 많은 순.
import type { LeadAdapter, RawLead, AdapterCtx } from "../types";
import { logError } from "@/lib/log";

// 발굴 시드 키워드 — 수도권 비프랜차이즈 베이커리·디저트·떡 위주. 관리자가 늘려도 됨.
const SEED_QUERIES = [
  "성수 디저트 맛집", "연남동 베이커리", "망원 디저트 전문점", "익선동 떡집",
  "서울 유명 떡집", "요즘 뜨는 베이커리", "수제 디저트 전문점", "경기 유명 떡집",
  "분당 디저트 맛집", "수원 베이커리 맛집",
];

const stripTags = (s: string) => s.replace(/<[^>]*>/g, "").trim();

function catFrom(raw: string): string {
  const s = raw;
  if (/떡|한과|방앗간/.test(s)) return "떡";
  if (/베이커리|제과|빵|소금빵|크로플|도넛/.test(s)) return "베이커리";
  if (/디저트|케이크|마카롱|타르트|카페/.test(s)) return "디저트";
  return "베이커리";
}

export const naverLocalAdapter: LeadAdapter = {
  id: "naver-local",
  track: "LOCAL",
  enabled: () => !!(process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET),
  async run(ctx: AdapterCtx): Promise<RawLead[]> {
    const id = process.env.NAVER_CLIENT_ID!;
    const secret = process.env.NAVER_CLIENT_SECRET!;
    const out: RawLead[] = [];
    for (const q of SEED_QUERIES) {
      if (out.length >= ctx.limit) break;
      try {
        const res = await fetch(
          `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(q)}&display=5&sort=comment`,
          {
            headers: { "X-Naver-Client-Id": id, "X-Naver-Client-Secret": secret },
            cache: "no-store",
          },
        );
        if (!res.ok) continue;
        const json = (await res.json()) as {
          items?: { title?: string; category?: string; address?: string; roadAddress?: string; link?: string; telephone?: string }[];
        };
        for (const it of json.items ?? []) {
          const name = stripTags(it.title ?? "");
          if (!name) continue;
          out.push({
            source: "naver-local",
            sourceRef: it.link || name,
            name,
            region: (it.roadAddress || it.address || "").split(" ").slice(0, 2).join(" "),
            category: catFrom(it.category || q),
            phone: it.telephone || "",
            url: it.link || "",
          });
        }
      } catch (e) {
        logError("sourcing.naverLocal", e, { q });
      }
    }
    return out.slice(0, ctx.limit);
  },
};
