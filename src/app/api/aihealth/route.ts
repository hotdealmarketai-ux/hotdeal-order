// ⚠️ 임시 진단용 — 프로덕션 AI 키/모델 상태 점검. 확인 후 삭제 예정.
// 비밀값은 노출하지 않는다(키 길이·성공여부·에러타입만).
import { normalizeOrder } from "@/lib/ai";

const TOKEN = "hd-aihealth-9f3k2";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("t") !== TOKEN) {
    return new Response("forbidden", { status: 403 });
  }

  const key = process.env.ANTHROPIC_API_KEY ?? "";
  const model = process.env.ANTHROPIC_MODEL || "(unset→claude-sonnet-4-6)";

  // 1) 원시 SDK 호출 — 진짜 에러(401/404 등)를 잡는다. normalizeOrder는 에러를 삼키므로 별도.
  const raw: {
    ok: boolean;
    status?: number | string;
    type?: string;
    error?: string;
    reply?: string;
  } = { ok: false };
  if (key) {
    try {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const msg = await new Anthropic({ apiKey: key }).messages.create({
        model: model.startsWith("(") ? "claude-sonnet-4-6" : model,
        max_tokens: 30,
        system: "JSON만 출력.",
        messages: [{ role: "user", content: '"영배추" 표준명? {"o":"..."}' }],
      });
      raw.ok = true;
      raw.reply = msg.content
        .map((b) => (b.type === "text" ? b.text : ""))
        .join("")
        .slice(0, 60);
    } catch (e) {
      const err = e as {
        status?: number;
        statusCode?: number;
        message?: string;
        type?: string;
        error?: { error?: { type?: string } };
      };
      raw.status = err?.status ?? err?.statusCode ?? "";
      raw.type = err?.error?.error?.type ?? err?.type ?? "";
      raw.error = String(err?.message ?? e).slice(0, 300);
    }
  }

  // 2) 앱이 실제로 쓰는 normalizeOrder 결과(엔진 claude/rule)
  let engine = "";
  let sample: unknown = null;
  try {
    const r = await normalizeOrder({
      categoryLabel: "야채",
      items: [{ name: "영배추", qty: "2박스", note: "" }],
    });
    engine = r.engine;
    sample = r.items[0];
  } catch {
    /* normalizeOrder는 실패해도 rule로 폴백하므로 여기 도달 X */
  }

  return new Response(
    JSON.stringify(
      {
        keyPresent: key.length > 0,
        keyLen: key.length, // 108이면 정상, 0이면 빈값(동기화 실패), 그 외는 잘림
        model,
        rawCall: raw,
        normalize: { engine, sample },
        node: process.version,
      },
      null,
      2,
    ),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}
