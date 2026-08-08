// 소싱 선별 — Claude로 후보를 랭킹(0~100) + 추천 이유 한 줄. 키 없으면 규칙 기반 폴백.
// 우리 = 핫딜마켓(오프라인 과일가게 기반 온라인 공동구매). 매일 2~3개 제품을 공구로 진행.
// 근거 강도(mentions=여러 매체가 겹쳐 언급한 수)를 중요하게 반영 — 단일 블로그 1건은 약한 근거.
import { logError } from "@/lib/log";

export type LeadCand = {
  name: string;
  region: string;
  category: string;
  reviewCount: number | null;
  mentions: number; // 서로 다른 매체/글이 언급한 수(근거 강도)
  note: string;
};
export type ProductCand = {
  name: string;
  brand: string;
  price: number | null;
  reviewCount: number | null;
  reviewVelocity: number; // 최근(주간) 리뷰 증가속도 = 수요 상승 신호
  mentions: number;
  note: string;
};
export type Scored = { score: number; reason: string };

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

// ── 규칙 기반 폴백(키 없을 때 or Claude 실패) ──
function ruleScoreLead(c: LeadCand): Scored {
  const rc = c.reviewCount ?? 0;
  // 근거(여러 매체 언급)와 리뷰량 중심. 단일 언급은 감점.
  const score = clamp(
    (c.mentions >= 3 ? 55 : c.mentions === 2 ? 42 : 28) + (rc > 0 ? Math.log10(rc + 1) * 12 : 0),
  );
  const bits = [
    c.mentions >= 2 ? `${c.mentions}개 매체 언급` : "단일 매체",
    rc > 0 ? `리뷰 ${rc.toLocaleString()}` : "",
    [c.region, c.category].filter(Boolean).join(" "),
  ].filter(Boolean);
  return { score, reason: bits.join(" · ") };
}
function ruleScoreProduct(c: ProductCand): Scored {
  const rc = c.reviewCount ?? 0;
  // 대중성(누적 리뷰) + 주간 급상승 + 근거. '관찰 중'은 정말 신호 없을 때만.
  const score = clamp(
    (rc > 0 ? Math.log10(rc + 1) * 16 : 0) + c.reviewVelocity * 6 + (c.mentions >= 2 ? 12 : 0) + 8,
  );
  const bits = [
    rc > 0 ? `리뷰 ${rc.toLocaleString()}` : "",
    c.reviewVelocity > 0 ? `이번 주 +${c.reviewVelocity.toFixed(0)}` : "",
    c.mentions >= 2 ? `${c.mentions}개 매체` : "",
  ].filter(Boolean);
  return { score, reason: bits.join(" · ") || "데이터 관찰 중" };
}

async function claudeScore(system: string, user: string): Promise<Scored[] | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 });
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const msg = await client.messages.create({
      model,
      max_tokens: 3000,
      system,
      messages: [{ role: "user", content: user }],
    });
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return null;
    const arr = JSON.parse(m[0]) as { score?: number; reason?: string }[];
    return arr.map((x) => ({ score: clamp(Number(x.score) || 0), reason: String(x.reason ?? "").slice(0, 140) }));
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
    "핵심 원칙: (1)근거가 강한 곳을 높게 줘 — 여러 매체/글에서 겹쳐 언급될수록(mentions↑) 진짜 화제인 것. 블로그 딱 1건에만 나온 곳(mentions=1)은 근거 부족이라 낮게. " +
    "(2)유명·인기·리뷰 많은 전문점은 가점(유명하다고 납품 거절하는 게 아니고, 납품 여부는 직접 컨택해 확인하니 감점 아님). 요즘 뜨는 신흥도 좋음. " +
    "(3)대형 프랜차이즈 체인·마트만 낮게. " +
    "각 후보를 0~100 점수와 '왜 공구에 좋은지(근거 포함)' 한국어 한 줄 이유로. 반드시 입력 순서대로 JSON 배열만: [{\"score\":0-100,\"reason\":\"...\"}]";
  const user = cands
    .map((c, i) => `${i + 1}. ${c.name} | ${c.region} | ${c.category} | 리뷰 ${c.reviewCount ?? "?"} | 언급매체 ${c.mentions} | ${c.note}`)
    .join("\n");
  const ai = await claudeScore(system, user);
  if (ai && ai.length === cands.length) return ai;
  return cands.map(ruleScoreLead);
}

export async function curateProducts(cands: ProductCand[]): Promise<Scored[]> {
  if (cands.length === 0) return [];
  const system =
    "너는 핫딜마켓의 밀키트·냉동 소싱 담당이야(주 1회 갱신, 이번 주 트렌드가 중요). " +
    "쿠팡·스마트스토어에서 실제로 많이 팔리는(대중 수요가 큰) 냉동·냉장 밀키트/간편식을 공동구매 후보로 점수화해. " +
    "핵심: (1)누적 리뷰가 많을수록=대중성 검증(가점). (2)이번 주 리뷰 급상승(reviewVelocity↑)=지금 뜨는 것(가점, 주간 트렌드). (3)여러 매체 언급(mentions↑)=근거 강함(가점). " +
    "(4)대기업 브랜드(비비고·팔도 등)는 이미 최저가라 가격 메리트 없어 감점/제외. 중소·산지·신생 가점. " +
    "데이터가 정말 없을 때만 낮은 점수. 각 후보를 0~100 점수와 한국어 한 줄 이유(대중성/트렌드 근거)로. 반드시 입력 순서대로 JSON 배열만: [{\"score\":0-100,\"reason\":\"...\"}]";
  const user = cands
    .map(
      (c, i) =>
        `${i + 1}. ${c.name} | 브랜드 ${c.brand || "?"} | 가격 ${c.price ?? "?"} | 리뷰 ${c.reviewCount ?? "?"} | 주간증가 ${c.reviewVelocity.toFixed(0)} | 언급매체 ${c.mentions} | ${c.note}`,
    )
    .join("\n");
  const ai = await claudeScore(system, user);
  if (ai && ai.length === cands.length) return ai;
  return cands.map(ruleScoreProduct);
}
