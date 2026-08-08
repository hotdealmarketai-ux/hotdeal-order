// 소싱 선별 — Claude로 후보를 랭킹(0~100) + 추천 이유 한 줄. 키 없으면 규칙 기반 폴백.
// 우리 = 핫딜마켓(오프라인 과일가게 기반 온라인 공동구매). 매일 2~3개 제품을 공구로 진행.
import { logError } from "@/lib/log";

export type LeadCand = {
  name: string;
  region: string;
  category: string;
  reviewCount: number | null;
  note: string;
};
export type ProductCand = {
  name: string;
  brand: string;
  price: number | null;
  reviewCount: number | null;
  reviewVelocity: number;
  note: string;
};
export type Scored = { score: number; reason: string };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ── 규칙 기반 폴백(키 없을 때 or Claude 실패) ──
function ruleScoreLead(c: LeadCand): Scored {
  const rc = c.reviewCount ?? 0;
  // 리뷰 많을수록↑(로그 스케일), 없으면 중립 40.
  const score = clamp(rc > 0 ? 30 + Math.log10(rc + 1) * 22 : 40);
  const reason = rc > 0 ? `리뷰 ${rc.toLocaleString()}·${c.region || "수도권"} ${c.category || ""} 전문점` : "신규 발견 후보";
  return { score, reason: reason.trim() };
}
function ruleScoreProduct(c: ProductCand): Scored {
  const rc = c.reviewCount ?? 0;
  // 리뷰 증가속도(수요 프록시) 가중 + 누적 리뷰.
  const score = clamp(c.reviewVelocity * 8 + (rc > 0 ? Math.log10(rc + 1) * 14 : 0) + 20);
  const bits = [
    c.reviewVelocity > 0 ? `리뷰 +${c.reviewVelocity.toFixed(1)}/일` : "",
    rc > 0 ? `누적 ${rc.toLocaleString()}` : "",
  ].filter(Boolean);
  return { score, reason: bits.join("·") || "수요 관찰 중" };
}

async function claudeScore(system: string, user: string): Promise<Scored[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const msg = await client.messages.create({
      model,
      max_tokens: 2000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]) as { score?: number; reason?: string }[];
    return arr.map((x) => ({ score: clamp(Number(x.score) || 0), reason: String(x.reason ?? "").slice(0, 120) }));
  } catch (e) {
    logError("sourcing.claudeScore", e, {});
    return null;
  }
}

export async function curateLeads(cands: LeadCand[]): Promise<Scored[]> {
  if (cands.length === 0) return [];
  const system =
    "너는 핫딜마켓(오프라인 과일가게 기반 온라인 공동구매)의 소싱 담당이야. " +
    "수도권의 베이커리·디저트·떡 '전문점' 중, 공동구매로 소개하면 반응이 좋을 컨택 후보를 점수화해. " +
    "유명하거나 리뷰가 많거나 입소문 나는 전문점일수록 높게 줘 — 유명하다고 납품을 거절하는 게 아니고, 납품 가능 여부는 우리가 직접 컨택해서 확인하니 감점 요소가 절대 아니다. " +
    "요즘 뜨는 신흥 전문점도 좋고, 이미 유명한 곳도 좋다. 오직 대형 프랜차이즈 체인·대형마트만 낮게. " +
    "각 후보를 0~100 점수와 '왜 공구에 좋은지' 한국어 한 줄 이유로. 반드시 입력 순서대로 JSON 배열만 출력: [{\"score\":0-100,\"reason\":\"...\"}]";
  const user = cands
    .map((c, i) => `${i + 1}. ${c.name} | ${c.region} | ${c.category} | 리뷰 ${c.reviewCount ?? "?"} | ${c.note}`)
    .join("\n");
  const ai = await claudeScore(system, user);
  if (ai && ai.length === cands.length) return ai;
  return cands.map(ruleScoreLead);
}

export async function curateProducts(cands: ProductCand[]): Promise<Scored[]> {
  if (cands.length === 0) return [];
  const system =
    "너는 핫딜마켓의 밀키트·냉동 소싱 담당이야. " +
    "쿠팡·스마트스토어에서 실제로 많이 팔리는(대중 수요가 큰) 냉동·냉장 밀키트/간편식을 공동구매 후보로 점수화해. " +
    "대기업 브랜드(비비고·팔도 등)는 이미 최저가라 가격 메리트 없어 제외/감점. 중소·산지·신생 브랜드 + 수요 상승(리뷰 증가속도) 가점. " +
    "각 후보를 0~100 점수와 한국어 한 줄 이유로. 반드시 입력 순서대로 JSON 배열만: [{\"score\":0-100,\"reason\":\"...\"}]";
  const user = cands
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} | 브랜드 ${c.brand || "?"} | 가격 ${c.price ?? "?"} | 리뷰 ${c.reviewCount ?? "?"} | 증가 ${c.reviewVelocity.toFixed(1)}/일 | ${c.note}`,
    )
    .join("\n");
  const ai = await claudeScore(system, user);
  if (ai && ai.length === cands.length) return ai;
  return cands.map(ruleScoreProduct);
}
