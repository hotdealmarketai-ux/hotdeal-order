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
- 서로 다른 품목을 합치지 말고, 수량의 '숫자'는 절대 바꾸거나 추정하지 마세요.
- [수량 단위] 적힌 그대로 두세요. 숫자만 있으면 숫자만(예: "3"→"3", "사과 2"→qty "2"), 단위가 적혀 있으면 그 단위 그대로(예: "20박스"→"20박스", "딸기 10kg"→"10kg", "대파 5단"→"5단"). 없는 단위(박스 등)를 임의로 만들어 붙이지 마세요. '숫자만'과 '숫자+단위'를 구분만 하면 됩니다.
- [다이는 '설명'이지 수량이 아님 · 매우 중요] "N다이"(예: 3다이·4다이·9다이)는 '한 박스에 든 낱개 개수 = 크기/등급'을 설명하는 말이에요. (예: 3다이 = 한 박스에 30~35개쯤 들어있는 크기) 주문 수량이 아니므로 qty에 넣지 말고 note(비고)에 적으세요. 실제 수량은 박스·개·숫자입니다.
  예) "부사 3다이 전반 4박스" → name "부사 사과", qty "4박스", note "3다이 전반"
  예) "사과 9다이 2박스" → qty "2박스", note "9다이"
  예) "사과 4다이"처럼 박스 수가 없으면 → qty "", note "4다이" (서로 다른 다이는 다른 크기이니 절대 합치지 마세요.)
- 부연설명(note)은 '짧은 명사 태그' 하나로만. 문장·존댓말 금지(자잘한 설명 X).
  예) "당도 높은 거"·"단 거"·"고당도로"→"고당도", "좋은 거"·"맛있는 거"·"상품으로"→"A급",
      "행사용"·"행사 쓸 거"→"행사", "특자"·"특상"→"특", "상자(등급)"→"상". 등급·요청 없으면 빈 문자열("").
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
//  채팅(카톡)식 발주 파싱 — 자유 문장/슬래시 형식을 품목으로 정리 + 카테고리 분류
// ============================================================
export interface ChatCatInfo {
  key: string; // FRUIT | VEG | TOOL | TOFU
  label: string;
  desc: string;
}
export interface ChatParseGroup {
  category: string;
  items: CleanItem[];
}
export interface ChatParseResult {
  engine: "claude" | "rule";
  groups: ChatParseGroup[];
  pickupTime: string; // 본문에서 픽업 시간을 언급했으면(소매업자) 추출
}
export interface ChatParseInput {
  text: string;
  categories: ChatCatInfo[]; // 이 사용자가 발주 가능한 카테고리
}

/** 규칙기반 채팅 파싱 — 키 없을 때. 줄/콤마/슬래시로 대충 분리. */
export function ruleChatParse(input: ChatParseInput): ChatParseResult {
  const cat = input.categories[0]?.key ?? "FRUIT";
  const chunks = tidy(input.text)
    .split(/[\n,，]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const items: CleanItem[] = [];
  for (const ch of chunks) {
    const parts = ch.split("/").map((p) => tidy(p));
    if (parts.length >= 2) {
      items.push({ name: parts[0], qty: parts[1] ?? "", note: parts[2] ?? "" });
    } else {
      items.push({ name: ch, qty: "", note: "" });
    }
  }
  return {
    engine: "rule",
    groups: items.length ? [{ category: cat, items }] : [],
    pickupTime: "",
  };
}

function chatSystemPrompt(cats: ChatCatInfo[], multi: boolean): string {
  const catLines = cats.map((c) => `  - ${c.key} (${c.label}): ${c.desc}`).join("\n");
  const onlyKey = cats[0]?.key ?? "FRUIT";
  const classifyRule = multi
    ? `[분류] 각 품목을 아래 카테고리 중 하나로 분류해 category에 키를 넣으세요. 허용된 카테고리만 사용:
${catLines}
  · 사과·귤·포도·딸기·참외·수박 등 = FRUIT(과일)
  · 대파·양배추·마늘쫑·상추·토마토·오이 등 = VEG(야채)
  · 그날 공동구매하는 포장 가공식품(곰탕·케이크 등) = TOOL(공구)
  · 두부·순두부·손두부·콩나물·숙주·봉지콩 등 '두부류'처럼 보여도 → VEG(야채)로 분류하세요. (채움채는 채팅이 아닌 별도 체크리스트로만 발주하므로, 채팅에선 두부류를 모두 야채로 보냅니다.)
  애매하면 가장 가까운 카테고리에 넣으세요.`
    : `[분류] 모든 품목의 category는 "${onlyKey}" 하나로 고정합니다.`;

  return `당신은 카톡처럼 자유롭게 적은 발주 메시지를 표준 발주서로 정리하는 보조원입니다.
입력은 두 형태가 섞일 수 있습니다:
 (1) "행사용 사과 / 20박스 / 싼걸로" 처럼 슬래시로 구분
 (2) "사장님 오늘 토마토 3개요, 사과는 좋은걸로 5박스 주세요" 처럼 일상 문장
각 품목을 뽑아 name(품목)·qty(수량)·note(부연설명)로 정리하세요.

[정규화]
- 품목명 오타·줄임말은 실제 표준명으로 교정하되, 비슷한 다른 단어로 '추측 교정' 금지(불확실하면 원문 유지).
- note는 짧은 명사 태그 하나만. 예) "싼걸로"·"저렴한"→"저가", "좋은걸로"·"상품으로"→"A급", "당도높은"→"고당도", "행사용"→"행사", "특"→"특". 없으면 "".
- 수량: 적힌 그대로(숫자는 임의 변경·추정 금지, 없으면 ""). 숫자만이면 숫자만("사과 3"→qty "3"), 단위가 있으면 그 단위 유지("20박스"→"20박스", "딸기 10kg"→"10kg", "대파 5단"→"5단"). 없는 단위(박스 등)를 임의로 붙이지 마세요.
- "N다이"(3다이·4다이 등)는 크기/등급을 설명하는 말이라 수량이 아니에요 → qty에 넣지 말고 note(비고)로 빼고, 실제 수량(박스·개·숫자)만 qty에 적으세요. 예) "부사 3다이 전반 4박스" → qty "4박스", note "3다이 전반".
- 인사말·잡담("사장님","오늘","요","주세요" 등)은 버리고 품목만 추립니다.
- 같은 품목을 여러 번 말하면 합치지 말고 적힌 그대로 각각.

${classifyRule}

[픽업] 본문에 픽업/수령 시간이 있으면 pickupTime에 그 시간만(없으면 "").

결과는 순수 JSON만(다른 말·코드블록 금지):
{"groups":[{"category":"${onlyKey}","items":[{"name":"사과","qty":"5박스","note":"A급"}]}],"pickupTime":""}`;
}

async function claudeChatParse(input: ChatParseInput): Promise<ChatParseResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no key");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const multi = input.categories.length > 1;
  const allowed = new Set(input.categories.map((c) => c.key));

  const msg = await client.messages.create({
    model,
    max_tokens: 2000,
    system: chatSystemPrompt(input.categories, multi),
    messages: [
      {
        role: "user",
        content: `다음 발주 메시지를 정리해 JSON으로만 답하세요.\n"""${input.text.slice(0, 2000)}"""`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = extractJson(text) as {
    groups?: { category?: string; items?: { name?: string; qty?: string; note?: string }[] }[];
    pickupTime?: string;
  };
  const fallbackCat = input.categories[0]?.key ?? "FRUIT";
  const groups: ChatParseGroup[] = (parsed.groups ?? [])
    .map((g) => {
      const key = allowed.has(String(g.category)) ? String(g.category) : fallbackCat;
      return {
        category: key,
        items: (g.items ?? [])
          .map((it) => ({
            name: tidy(it.name ?? ""),
            qty: tidy(it.qty ?? ""),
            note: tidy(it.note ?? ""),
          }))
          .filter((it) => it.name || it.qty || it.note),
      };
    })
    .filter((g) => g.items.length > 0);
  if (groups.length === 0) throw new Error("empty chat parse");
  return { engine: "claude", groups, pickupTime: tidy(parsed.pickupTime ?? "") };
}

/** 메인 진입점 — 항상 결과 보장(폴백) */
export async function parseChatOrder(input: ChatParseInput): Promise<ChatParseResult> {
  if (!tidy(input.text)) return { engine: "rule", groups: [], pickupTime: "" };
  try {
    if (process.env.ANTHROPIC_API_KEY) return await claudeChatParse(input);
  } catch (err) {
    console.error("[ai] claude chat parse failed, falling back to rule:", err);
  }
  return ruleChatParse(input);
}

// ============================================================
//  픽업 시간 정리 — 사람이 적은 시간을 '오전/오후 H시 M분'으로 정갈하게
// ============================================================
export async function normalizePickupTime(raw: string): Promise<string> {
  const r = tidy(raw);
  if (!r) return "";
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return r;
  try {
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
    const msg = await client.messages.create({
      model,
      max_tokens: 60,
      system:
        "사람이 적은 픽업 시간을 '오전/오후 H시 M분' 형식의 깔끔한 한국어로만 변환하세요. " +
        "시간 표현만 출력(다른 말·문장 금지). 분이 0이면 분을 생략. " +
        "예: '일곱시삼십분'→'오전 7시 30분', '8시반'→'오전 8시 30분', '오후2시'→'오후 2시', '7시'→'오전 7시'. " +
        "시간으로 해석할 수 없으면 입력을 그대로 출력.",
      messages: [{ role: "user", content: r }],
    });
    const out = tidy(msg.content.map((b) => (b.type === "text" ? b.text : "")).join(""));
    return out || r;
  } catch (err) {
    console.error("[ai] pickup normalize failed:", err);
    return r;
  }
}

// ============================================================
//  집계 발주서 — 여러 지점 주문을 [품목 > 종류] 2단계로 묶고 합산
// ============================================================
export type AggregateMode = "produce" | "simple";
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
3) 각 종류마다: 지점별 내역(lines: store·qty·note), 박스·개·단·봉지·kg 같은 '진짜 수량 단위'가 일관될 때만 합산 total(예 3박스+5박스=8박스), 애매하면 "".
4) 각 품목(fruit)에도 진짜 수량 단위가 일관될 때만 합산 total(아니면 "").
5) note(요청)는 '짧은 명사 태그' 하나로만(문장 금지). 예: "당도 높은 상품으로 요청"→"고당도", "좋은 거"→"A급", "행사용"→"행사", "특"→"특". 없으면 "".

[다이는 설명·등급] "N다이"(3다이·4다이 등)는 크기/등급을 설명하는 말이라 수량이 아닙니다. qty가 아니라 note(요청·등급)로 다루세요. 절대 합산하지 말고, 같은 품종이라도 다이(등급)가 다르면 note로 구분하세요. 수량 합산(total)은 박스·개·kg 같은 진짜 수량 단위로만 하세요.
[금지] 서로 다른 품종 합치기 금지. 없는 품목 추측 생성 금지. 수량 임의변경 금지(합산은 진짜 수량 단위가 같을 때만, 다이는 합산 금지).

결과는 순수 JSON만:
{"fruits":[{"fruit":"사과","total":"품목 합계 또는 빈문자열","varieties":[{"variety":"부사","total":"종류 합계 또는 빈문자열","lines":[{"store":"지점","qty":"수량","note":"요청"}]},{"variety":"일반","total":"","lines":[]}]}],"summary":"한 줄 요약"}`;

// 공구·두부류 등 — 그날 진행 품목이 정해진 카테고리. 가볍게 '같으면 묶기'만.
const AGG_SIMPLE_PROMPT = `여러 지점에서 들어온 발주를 '집계'하는 도매 보조원입니다.
이 카테고리(공구/두부류 등)는 그날 진행하는 품목이 정해져 있어, 사람마다 다르게 적어도 같은 상품인 경우가 많습니다.

[묶기 규칙 — 가볍게]
- 같은 상품이면 하나로 묶으세요.
  예) "떠먹는 케이크"와 "떠먹는 망고케이크"는 같은 상품, "해늘 소머리곰탕"과 "소머리곰탕"도 같은 상품.
- 대표 품목명(fruit 필드)은 '더 상세하게 적힌 이름'을 채택하세요. (예: "떠먹는 망고케이크", "해늘 소머리곰탕")
- variety(종류)는 항상 빈 문자열 "" 로 두고, 품종으로 쪼개지 마세요.
- 확실히 다른 상품만 분리하세요. 애매하면 따로 두세요(임의로 합치지 말 것).
- 각 품목마다 지점별 내역(lines: store·qty·note), 단위 일관 시 합산 total(아니면 "").
- note(요청)는 짧은 명사 태그 하나로만, 없으면 "".

결과는 순수 JSON만:
{"fruits":[{"fruit":"떠먹는 망고케이크","total":"합계 또는 빈문자열","varieties":[{"variety":"","total":"","lines":[{"store":"지점","qty":"수량","note":""}]}]}],"summary":"한 줄 요약"}`;

async function claudeAggregate(
  input: AggregateInput,
  mode: AggregateMode,
): Promise<AggregateResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no key");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const payload = { category: input.categoryLabel, lines: input.lines.slice(0, 400) };
  const msg = await client.messages.create({
    model,
    max_tokens: 5000,
    system: mode === "simple" ? AGG_SIMPLE_PROMPT : AGG_SYSTEM_PROMPT,
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
export async function aggregateOrders(
  input: AggregateInput,
  mode: AggregateMode = "produce",
): Promise<AggregateResult> {
  if (input.lines.length === 0) {
    return { engine: "rule", fruits: [], summary: `${input.categoryLabel} 집계 · 발주 없음` };
  }
  try {
    if (process.env.ANTHROPIC_API_KEY) return await claudeAggregate(input, mode);
  } catch (err) {
    console.error("[ai] claude aggregate failed, falling back to rule:", err);
  }
  return ruleAggregate(input);
}

// ============================================================
//  경매 입찰 안내 — 오늘 발주 기반 (AI, 정중한 입찰 요청 문장)
// ============================================================
export interface AuctionReportResult {
  engine: "claude" | "rule";
  sentences: string[]; // "사과는 9다이 입찰해주시면 됩니다." 형태의 문장들
}
export interface ReportInput {
  contextLabel: string;
  dateLabel: string;
  lines: { store: string; name: string; qty: string; note: string }[];
}

/** 규칙기반(키 없을 때) — 집계 기반 준비 정리. */
export function ruleReport(input: ReportInput): AuctionReportResult {
  const agg = ruleAggregate({ categoryLabel: input.contextLabel, lines: input.lines });
  const sentences: string[] = [];
  for (const f of agg.fruits) {
    for (const v of f.varieties) {
      const label =
        v.variety && v.variety !== "일반" ? `${v.variety} ${f.fruit}` : f.fruit;
      const qty = v.total || `${v.lines.length}건`;
      sentences.push(`${label} — ${qty} 입찰 준비`);
    }
  }
  return { engine: "rule", sentences };
}

const REPORT_SYSTEM_PROMPT = `오늘 들어온 발주를 토대로, 청과 경매에 나가는 담당자가 '무엇을 얼마나 입찰·준비해야 하는지' 업무적으로 정리하는 도구입니다.
전략·조언·미사여구 금지. 사무적이고 간결하게.

규칙:
- 들어온 발주량 = 필요 수량. 발주 없는 건 제외.
- 품목/종류별로 한 줄씩. 형식: "[항목] — [수량] 입찰 준비" (수량은 박스·건 등 실제 수량)
  예) "부사 사과 — 6박스 입찰 준비", "샤인머스캣 — 4박스 입찰 준비", "감귤 — 5박스 입찰 준비"
- "다이"는 한 박스 속 낱개 개수=크기/등급이라 수량이 아닙니다. 등급/요청(다이·특·고당도·행사 등)은 항목 뒤 괄호로: "부사 사과(3다이 전반) — 4박스 입찰 준비".
- 같은 항목은 진짜 수량 단위(박스·개·단·kg)가 같을 때만 합산. 등급(다이)이 다르면 등급별로 한 줄씩.
- 과일 분류 정확히: 부사·홍로·시나노골드=사과, 거봉·샤인머스캣·어텀크리스피=포도, 한라봉·천혜향=감귤.
- 같은 과일끼리 인접하도록 정렬.

결과는 순수 JSON만:
{"sentences":["부사 사과(특·3다이) — 3박스 입찰 준비","부사 사과 — 6박스 입찰 준비","시나노골드 — 3박스 입찰 준비","샤인머스캣 — 4박스 입찰 준비"]}`;

async function claudeReport(input: ReportInput): Promise<AuctionReportResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("no key");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey });
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

  const payload = { date: input.dateLabel, lines: input.lines.slice(0, 400) };
  const msg = await client.messages.create({
    model,
    max_tokens: 3000,
    system: REPORT_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `다음 발주를 토대로 오늘 발주 준비 정리를 JSON으로만 만드세요.\n${JSON.stringify(payload, null, 2)}`,
      },
    ],
  });
  const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = extractJson(text) as { sentences?: string[] };
  const sentences = (parsed.sentences ?? [])
    .map((s) => tidy(s))
    .filter((s) => s.length > 0);
  if (sentences.length === 0 && input.lines.length > 0) throw new Error("empty report");
  return { engine: "claude", sentences };
}

/** 메인 진입점 — 항상 결과 보장(폴백) */
export async function auctionReport(input: ReportInput): Promise<AuctionReportResult> {
  if (input.lines.length === 0) {
    return { engine: "rule", sentences: [] };
  }
  try {
    if (process.env.ANTHROPIC_API_KEY) return await claudeReport(input);
  } catch (err) {
    console.error("[ai] claude report failed, falling back to rule:", err);
  }
  return ruleReport(input);
}
