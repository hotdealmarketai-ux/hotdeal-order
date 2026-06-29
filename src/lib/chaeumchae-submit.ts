// 채움채(hancuc.co.kr) 자동 발주 제출 — key로 세션 확보 후 품목별 INSERT.
// 서버 전용. 실패 시 호출자가 알림 처리.
const BASE = "http://hancuc.co.kr";
const CUSTOMER_SEQ = "1138";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

export type SubmitItem = { seq: string; name: string; quantity: number };
export type SubmitResult = {
  seq: string;
  name: string;
  quantity: number;
  result: string; // INSERT | OVERLAP | ERR
};

type Session = { csrf: string; cookie: string };

// key 페이지를 열어 laravel_session 쿠키 + csrf 토큰 확보
async function fetchSession(): Promise<Session> {
  const key = process.env.CHAEUMCHAE_KEY;
  if (!key) throw new Error("CHAEUMCHAE_KEY 미설정");

  const res = await fetch(`${BASE}/order_insert?key=${key}`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`세션 페이지 응답 ${res.status}`);
  const html = await res.text();

  const m =
    html.match(/name="csrf-token"\s+content="([^"]+)"/i) ||
    html.match(/csrf-token["']?\s+content=["']([^"']+)["']/i);
  const csrf = m?.[1];

  const setCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [res.headers.get("set-cookie") ?? ""];
  const jar: Record<string, string> = {};
  for (const sc of setCookies) {
    if (!sc) continue;
    const pair = sc.split(";")[0];
    const i = pair.indexOf("=");
    if (i > 0) jar[pair.slice(0, i).trim()] = pair.slice(i + 1).trim();
  }

  if (!csrf) throw new Error("csrf 토큰 없음(키 만료 가능)");
  if (!jar["laravel_session"]) throw new Error("세션 쿠키 없음(키 만료 가능)");

  const cookie =
    `current_pg=menu_order_insert; laravel_session=${jar["laravel_session"]}` +
    (jar["XSRF-TOKEN"] ? `; XSRF-TOKEN=${jar["XSRF-TOKEN"]}` : "");
  return { csrf, cookie };
}

async function insertProduct(
  sess: Session,
  orderDay: string,
  it: SubmitItem,
): Promise<SubmitResult> {
  const body = new URLSearchParams({
    customer_seq: CUSTOMER_SEQ,
    order_day: orderDay,
    product_seq: it.seq,
    quantity: String(it.quantity),
  });
  try {
    const res = await fetch(`${BASE}/api_customer_order_product_insert`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-TOKEN": sess.csrf,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: sess.cookie,
        Origin: BASE,
        Referer: `${BASE}/order_insert?key=${process.env.CHAEUMCHAE_KEY}`,
        "User-Agent": UA,
      },
      body,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => null)) as {
      extend?: { api_result?: string }[];
    } | null;
    const result = json?.extend?.[0]?.api_result ?? "ERR";
    return { seq: it.seq, name: it.name, quantity: it.quantity, result };
  } catch {
    return { seq: it.seq, name: it.name, quantity: it.quantity, result: "ERR" };
  }
}

// 발주 제출 — 세션 1번 따서 품목별로 INSERT. 세션 실패 시 throw.
export async function submitChaeumchae(
  orderDay: string,
  items: SubmitItem[],
): Promise<SubmitResult[]> {
  const sess = await fetchSession();
  const results: SubmitResult[] = [];
  for (const it of items) {
    // 순차 호출 (같은 세션/주문에 쌓이므로)
    results.push(await insertProduct(sess, orderDay, it));
  }
  return results;
}
