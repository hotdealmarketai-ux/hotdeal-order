// ============================================================
//  발주 정리 AI
//  - ANTHROPIC_API_KEY 있으면 Claude로 정갈하게 정리
//  - 없거나 실패하면 규칙기반(rule)으로 자동 폴백 → 앱은 항상 동작
//  - 핵심 원칙: 의미(품목/수량)는 바꾸지 않는다. 표기만 다듬는다.
// ============================================================

export interface RawItem {
  name: string;
  qty: string;
  note: string;
}
export interface CleanItem {
  name: string;
  qty: string;
  note: string;
}
export interface NormalizeResult {
  engine: "claude" | "rule";
  items: CleanItem[];
  summary: string;
}

export interface NormalizeInput {
  categoryLabel: string;
  items: RawItem[];
  pickupTime?: string;
}

function tidy(s: string): string {
  return (s ?? "")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** 규칙기반 정리 — 결정적, 안전(의미 보존). 키 없을 때 기본 동작. */
export function ruleNormalize(input: NormalizeInput): NormalizeResult {
  const items: CleanItem[] = input.items
    .map((it) => ({
      name: tidy(it.name),
      qty: tidy(it.qty),
      note: tidy(it.note),
    }))
    .filter((it) => it.name || it.qty || it.note);

  const summary =
    items.length > 0
      ? `${input.categoryLabel} 발주 ${items.length}건`
      : `${input.categoryLabel} 발주`;

  return { engine: "rule", items, summary };
}

const SYSTEM_PROMPT = `당신은 과일·농산물 도매 발주서를 정리하는 사무 보조원입니다.
점주가 손으로 급히 적어 지저분한 발주 항목(품목/수량/부연설명)을 받아, 사무적이고 정갈하게 다듬습니다.

엄격한 규칙:
1) 의미를 절대 바꾸지 마세요. 품목명·수량을 임의로 바꾸거나 합치거나 추정하지 마세요.
2) 오타, 띄어쓰기, 중복 공백, 군더더기 표현만 교정합니다.
3) 부연설명(등급/다이/요청사항)은 간결한 사무체로 정리합니다.
   예) "맛있는걸로 챙겨줘잉" → "상품(上品)으로 요청"
   예) "4다이 전반" → "4다이(전반)"
4) 항목 개수와 순서는 그대로 유지합니다. 빈 값은 빈 문자열("")로 둡니다.
5) 결과는 JSON만 출력합니다. 다른 말, 코드블록 표시 없이 순수 JSON.

출력 형식:
{"items":[{"name":"품목","qty":"수량","note":"정리된 부연설명"}],"summary":"한 줄 요약"}`;

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) throw new Error("no json");
  return JSON.parse(text.slice(start, end + 1));
}

/** Claude 정리 — 실패 시 호출자가 규칙기반으로 폴백 */
async function claudeNormalize(input: NormalizeInput): Promise<NormalizeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no key");

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

  const payload = {
    category: input.categoryLabel,
    pickupTime: input.pickupTime ?? null,
    items: input.items.slice(0, 200).map((it) => ({
      name: tidy(it.name),
      qty: tidy(it.qty),
      note: tidy(it.note),
    })),
  };

  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `다음 발주를 정리해 JSON으로만 답하세요.\n${JSON.stringify(
          payload,
          null,
          2,
        )}`,
      },
    ],
  });

  const text = msg.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("");

  const parsed = extractJson(text) as {
    items?: { name?: string; qty?: string; note?: string }[];
    summary?: string;
  };

  const items: CleanItem[] = (parsed.items ?? []).map((it) => ({
    name: tidy(it.name ?? ""),
    qty: tidy(it.qty ?? ""),
    note: tidy(it.note ?? ""),
  }));

  // 항목 수가 입력과 다르면 인덱스 정렬을 신뢰할 수 없으므로 규칙기반(1:1 보존)으로 폴백
  if (items.length !== input.items.length) {
    throw new Error(
      `item count mismatch: got ${items.length}, expected ${input.items.length}`,
    );
  }

  return {
    engine: "claude",
    items,
    summary: tidy(parsed.summary ?? "") || `${input.categoryLabel} 발주 ${items.length}건`,
  };
}

/** 메인 진입점 — 항상 결과를 돌려준다(폴백 보장) */
export async function normalizeOrder(input: NormalizeInput): Promise<NormalizeResult> {
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      return await claudeNormalize(input);
    }
  } catch (err) {
    console.error("[ai] claude normalize failed, falling back to rule:", err);
  }
  return ruleNormalize(input);
}
