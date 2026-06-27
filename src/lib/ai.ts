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
  어텀크리스피(Autumn Crisp · 씨없는 청포도), 스위티오, 아보카도 등.

[임무 2 · 매우 중요] 과교정(추측 교정) 절대 금지:
- 비슷하게 '들리는' 다른 단어로 추측해서 바꾸지 마세요. 이건 발주 사고입니다.
  나쁜 예) "시나노골드"→"시나몬골드"(❌, 시나노골드가 정답), "어텀크리스피"→"오토캐럿..."(❌)
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

// ============================================================
//  집계 발주서 — 여러 지점 주문을 [품목 > 종류] 2단계로 묶고 합산
// ============================================================
export interface AggLine {
  store: string;
  qty: string;
  note: string;
}
export interface AggVariety {
  variety: string; // 종류(품종). 표기 없으면 "일반"
  total: string;
  lines: AggLine[];
}
export interface AggFruit {
  fruit: string; // 품목(과일)
  total: string;
  varieties: AggVariety[];
}
export interface AggregateResult {
  engine: "claude" | "rule";
  fruits: AggFruit[];
  summary: string;
}
export interface AggregateInput {
  categoryLabel: string;
  lines: { store: string; name: string; qty: string; note: string }[];
}

/** 규칙기반 집계 — 동일 품목명끼리만 묶음(AI 없을 때, 2단계 분리는 못 함). */
export function ruleAggregate(input: AggregateInput): AggregateResult {
  const map = new Map<string, AggLine[]>();
  for (const l of input.lines) {
    const key = tidy(l.name) || "(미지정)";
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({ store: l.store, qty: tidy(l.qty), note: tidy(l.note) });
  }
  const fruits: AggFruit[] = [...map.entries()]
    .map(([fruit, lines]) => ({
      fruit,
      total: "",
      varieties: [{ variety: "", total: "", lines }],
    }))
    .sort((a, b) => b.varieties[0].lines.length - a.varieties[0].lines.length);
  return {
    engine: "rule",
    fruits,
    summary: `${input.categoryLabel} 집계 · 품목 ${fruits.length}종 / 지점 발주 ${input.lines.length}건`,
  };
}

const AGG_SYSTEM_PROMPT = `여러 지점에서 들어온 발주를 '집계 발주서'로 취합하는 도매 보조원입니다.
입력은 여러 지점의 발주 목록(지점명·품목·수량·요청)입니다.

[2단계로 묶기]
1) 품목(fruit): 같은 과일끼리 한 그룹. 품종이 '어느 과일'인지 실제 분류를 정확히 판단하세요.
   - 사과 품종: 부사(후지)·홍로·감홍·시나노골드·아오리·양광 등
   - 포도 품종: 거봉·샤인머스캣·캠벨·델라웨어·머루·어텀크리스피(어텀크리스프)·청포도 등
   - 감귤 품종: 한라봉·천혜향·레드향·황금향 등
   예) "부사 사과"·"그냥 사과"·"시나노골드"는 모두 품목 "사과"이지만, "어텀크리스피"·"샤인머스캣"은 품목 "포도"입니다. (헷갈리지 마세요)
2) 종류(variety): 그 품목 안에서 품종별로 다시 나눔. 예) 부사 사과 → 종류 "부사", 시나노골드 → "시나노골드". 품종 표기가 없는 그냥 사과 → 종류 "일반".
   - 같은 품목이라도 종류가 다르면 종류를 나누고, 같은 종류면 합칩니다.
3) 각 종류마다: 지점별 내역(lines: store·qty·note), 단위 일관 시 합산 total(예 3다이+5다이=8다이), 애매하면 "".
4) 각 품목(fruit)에도 단위 일관 시 합산 total(아니면 "").

[금지] 서로 다른 품종 합치기 금지. 없는 품목 추측 생성 금지. 수량 임의변경 금지(합산은 단위 같을 때만).

결과는 순수 JSON만:
{"fruits":[{"fruit":"사과","total":"품목 합계 또는 빈문자열","varieties":[{"variety":"부사","total":"종류 합계 또는 빈문자열","lines":[{"store":"지점","qty":"수량","note":"요청"}]},{"variety":"일반","total":"","lines":[]}]}],"summary":"한 줄 요약"}`;

async function claudeAggregate(input: AggregateInput): Promise<AggregateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no key");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const payload = { category: input.categoryLabel, lines: input.lines.slice(0, 400) };
  const msg = await client.messages.create({
    model,
    max_tokens: 5000,
    system: AGG_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `다음 발주들을 [품목 > 종류]로 취합해 JSON으로만 답하세요.\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = extractJson(text) as {
    fruits?: {
      fruit?: string;
      total?: string;
      varieties?: {
        variety?: string;
        total?: string;
        lines?: { store?: string; qty?: string; note?: string }[];
      }[];
    }[];
    summary?: string;
  };
  const fruits: AggFruit[] = (parsed.fruits ?? [])
    .map((f) => ({
      fruit: tidy(f.fruit ?? ""),
      total: tidy(f.total ?? ""),
      varieties: (f.varieties ?? []).map((v) => ({
        variety: tidy(v.variety ?? ""),
        total: tidy(v.total ?? ""),
        lines: (v.lines ?? []).map((l) => ({
          store: tidy(l.store ?? ""),
          qty: tidy(l.qty ?? ""),
          note: tidy(l.note ?? ""),
        })),
      })),
    }))
    .filter((f) => f.fruit || f.varieties.length);
  if (fruits.length === 0 && input.lines.length > 0) throw new Error("empty aggregate");
  return {
    engine: "claude",
    fruits,
    summary: tidy(parsed.summary ?? "") || `${input.categoryLabel} 집계 · 품목 ${fruits.length}종`,
  };
}

/** 메인 진입점 — 항상 결과 보장(폴백) */
export async function aggregateOrders(input: AggregateInput): Promise<AggregateResult> {
  if (input.lines.length === 0) {
    return { engine: "rule", fruits: [], summary: `${input.categoryLabel} 집계 · 발주 없음` };
  }
  try {
    if (process.env.ANTHROPIC_API_KEY) return await claudeAggregate(input);
  } catch (err) {
    console.error("[ai] claude aggregate failed, falling back to rule:", err);
  }
  return ruleAggregate(input);
}

// ============================================================
//  경매 입찰 전략 레포트 — 오늘 발주 기반 (AI)
// ============================================================
export interface ReportVariety {
  variety: string;
  qty: string;
  note: string;
}
export interface ReportFruit {
  fruit: string;
  totalDemand: string;
  varieties: ReportVariety[];
  strategy: string;
}
export interface AuctionReportResult {
  engine: "claude" | "rule";
  overall: string;
  fruits: ReportFruit[];
}
export interface ReportInput {
  contextLabel: string;
  dateLabel: string;
  lines: { store: string; name: string; qty: string; note: string }[];
}

/** 규칙기반 레포트(키 없을 때) — 집계만 보여주는 최소형. */
export function ruleReport(input: ReportInput): AuctionReportResult {
  const agg = ruleAggregate({ categoryLabel: input.contextLabel, lines: input.lines });
  return {
    engine: "rule",
    overall: `${input.dateLabel} 발주 ${input.lines.length}건. 들어온 품목·수량만큼 확보하세요.`,
    fruits: agg.fruits.map((f) => ({
      fruit: f.fruit,
      totalDemand: "",
      varieties: f.varieties.flatMap((v) =>
        v.lines.map((l) => ({ variety: v.variety || f.fruit, qty: l.qty, note: l.note })),
      ),
      strategy: "들어온 발주량만큼 확보. 등급·당도 요청 반영.",
    })),
  };
}

const REPORT_SYSTEM_PROMPT = `청과 중매인이 오늘 도매시장 경매에서 어떻게 입찰할지, 들어온 발주를 토대로 '경매 입찰 전략 레포트'를 만드는 전문가입니다.
핵심 원칙: 들어온 발주량 = 확보(낙찰)해야 할 양. 발주 없는 품목은 사지 않음.

입력: 여러 지점의 발주(지점·품목·수량·요청).
과일(품목)별로 만드세요:
- fruit: 과일명(사과/포도/감귤 등 품목 단위). 품종이 어느 과일인지 정확히: 부사·홍로·시나노골드=사과, 거봉·샤인머스캣·어텀크리스피=포도, 한라봉·천혜향=감귤.
- totalDemand: 그 과일 총 필요량(단위 일관 시 합산, 아니면 종류별 합을 간단히)
- varieties: 종류별 [variety 종류명, qty 필요량, note 핵심 요청(등급/당도/픽업 등)]
- strategy: 실전 입찰 전략 1~2문장. 종류·등급 우선순위, 당도/품질 요청 반영, 픽업시간 급한 건 우선 확보 등 구체적으로.
overall: 오늘 경매 전체 전략 1~2문장(어떤 품목부터, 무엇에 집중할지).

직관적이고 실전적으로. 추측으로 없는 품목을 만들지 마세요.
결과는 순수 JSON만:
{"overall":"전체 전략","fruits":[{"fruit":"사과","totalDemand":"12다이","varieties":[{"variety":"부사","qty":"9다이","note":"특/상 다수"},{"variety":"일반","qty":"3다이","note":""}],"strategy":"부사 특·상 9다이 우선 확보, 일반 3다이는 시세 보고. 당도 요청 많아 고당도 위주."}]}`;

async function claudeReport(input: ReportInput): Promise<AuctionReportResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no key");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const payload = { date: input.dateLabel, lines: input.lines.slice(0, 400) };
  const msg = await client.messages.create({
    model,
    max_tokens: 5000,
    system: REPORT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `다음 발주를 토대로 오늘 경매 입찰 전략 레포트를 JSON으로만 만드세요.\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = extractJson(text) as {
    overall?: string;
    fruits?: {
      fruit?: string;
      totalDemand?: string;
      varieties?: { variety?: string; qty?: string; note?: string }[];
      strategy?: string;
    }[];
  };
  const fruits: ReportFruit[] = (parsed.fruits ?? [])
    .map((f) => ({
      fruit: tidy(f.fruit ?? ""),
      totalDemand: tidy(f.totalDemand ?? ""),
      varieties: (f.varieties ?? []).map((v) => ({
        variety: tidy(v.variety ?? ""),
        qty: tidy(v.qty ?? ""),
        note: tidy(v.note ?? ""),
      })),
      strategy: tidy(f.strategy ?? ""),
    }))
    .filter((f) => f.fruit);
  if (fruits.length === 0 && input.lines.length > 0) throw new Error("empty report");
  return { engine: "claude", overall: tidy(parsed.overall ?? ""), fruits };
}

/** 메인 진입점 — 항상 결과 보장(폴백) */
export async function auctionReport(input: ReportInput): Promise<AuctionReportResult> {
  if (input.lines.length === 0) {
    return { engine: "rule", overall: "들어온 발주가 없어요.", fruits: [] };
  }
  try {
    if (process.env.ANTHROPIC_API_KEY) return await claudeReport(input);
  } catch (err) {
    console.error("[ai] claude report failed, falling back to rule:", err);
  }
  return ruleReport(input);
}
