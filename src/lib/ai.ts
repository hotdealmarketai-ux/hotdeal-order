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
점주(주로 어르신)가 급히 적어 오타·줄임말이 많은 발주를 받아, '실제 존재하는 표준 품목명'으로 정확하고 정갈하게 정리합니다.

[임무 1] 품목명 오타·줄임말 교정:
- 명백한 오타·줄임말은 실제 존재하는 표준 과일/농산물 이름으로 바로잡으세요.
  예) "망고르틴"·"망고쥬틴"→"망고스틴", "샤인"·"샤인머스켓"→"샤인머스캣",
      "방울도마도"→"방울토마토", "파인에플"→"파인애플", "사과루"→"사과", "딸끼"→"딸기"
- 수입·신품종도 표준명으로(정확한 표기 주의):
  망고스틴, 람부탄, 두리안, 리치, 용과, 거봉, 캠벨, 시나노골드, 감홍, 부사(후지),
  어텀크리스프(오텀크리스프), 스위티오, 아보카도 등.

[임무 2 · 매우 중요] 과교정(추측 교정) 절대 금지:
- 비슷하게 '들리는' 다른 단어로 추측해서 바꾸지 마세요. 이건 발주 사고입니다.
  나쁜 예) "시나노골드"→"시나몬골드"(❌, 시나노골드가 정답), "어텀크리스프"→"오토캐럿..."(❌)
- 실제로 존재한다고 '확신'할 때만 교정(자모 한두 개 어긋난 명백한 오타만).
- 정체가 조금이라도 불확실하거나 모르는 품종명이면 → 원문 그대로 두세요(원문 유지가 안전).

[기타]
- 서로 다른 품목을 합치지 말고, 수량(다이/박스/개수)은 절대 바꾸거나 추정하지 마세요.
- 등급·품질(특·상·고당도 등)은 보존하되 부연설명에 사무체로 정리.
  예) "맛있는걸로 챙겨줘잉"→"상품(上品)으로 요청", "4다이 전반"→"4다이(전반)"
- 항목 개수와 순서는 반드시 그대로 유지, 빈 값은 "".

결과는 순수 JSON만 출력(다른 말·코드블록 금지):
{"items":[{"name":"표준 품목명","qty":"수량","note":"정리된 부연설명"}],"summary":"한 줄 요약"}`;

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
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

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
