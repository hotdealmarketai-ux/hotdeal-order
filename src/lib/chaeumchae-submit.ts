// 채움채(hancuc.co.kr) 자동 발주 제출 — key로 세션 확보 후 품목별 INSERT.
// 서버 전용. 실패 시 호출자가 알림 처리.
//
// 2026-08 서버 개편 대응: 페이지 order_insert → order_insert2, API insert → insert2,
// POST 파라미터에 type(box/ea) 추가, 키 변경. (사이트 JS의 autoSubmitProduct payload와 동일하게 맞춤.)
const BASE = "http://www.hancuc.co.kr";
const CUSTOMER_SEQ = "1138";
// 사이트가 공개적으로 발급한 이 고객 접근 key(URL에 노출됨). env로 덮어쓸 수 있음(키 회전 시).
const DEFAULT_KEY = "bDRsVnNreld1dWh4OEJIZ25WTTZrZz09";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36";

function chaeumchaeKey() {
  return process.env.CHAEUMCHAE_KEY || DEFAULT_KEY;
}

export type SubmitItem = { seq: string; name: string; quantity: number; type?: string };
export type SubmitResult = {
  seq: string;
  name: string;
  quantity: number;
  result: string; // INSERT | OVERLAP | ERR
};

type Session = { csrf: string; cookie: string; orderDay: string };

// key 페이지(order_insert2)를 열어 laravel_session 쿠키 + csrf 토큰 + 출고일(order_day) 확보.
async function fetchSession(): Promise<Session> {
  const key = chaeumchaeKey();
  const res = await fetch(`${BASE}/order_insert2?key=${key}`, {
    headers: { "User-Agent": UA },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`세션 페이지 응답 ${res.status}`);
  const html = await res.text();

  const csrf =
    html.match(/name="csrf-token"\s+content="([^"]+)"/i)?.[1] ||
    html.match(/csrf-token["']?\s+content=["']([^"']+)["']/i)?.[1];

  // 페이지가 심어주는 출고일(항상 다음 영업일). 우리 계산값보다 이걸 신뢰(휴일 등 대비).
  const orderDay =
    html.match(/id="order_day"\s+value="([0-9-]+)"/i)?.[1] ||
    html.match(/order_day["']?\s+value=["']([0-9-]+)["']/i)?.[1] ||
    "";

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
    `laravel_session=${jar["laravel_session"]}` +
    (jar["XSRF-TOKEN"] ? `; XSRF-TOKEN=${jar["XSRF-TOKEN"]}` : "");
  return { csrf, cookie, orderDay };
}

async function insertProduct(
  sess: Session,
  orderDay: string,
  it: SubmitItem,
): Promise<SubmitResult> {
  // 사이트 JS(autoSubmitProduct)와 동일한 5개 필드: customer_seq, order_day, product_seq, quantity, type.
  const body = new URLSearchParams({
    customer_seq: CUSTOMER_SEQ,
    order_day: orderDay,
    product_seq: it.seq,
    quantity: String(it.quantity),
    type: it.type || "box",
  });
  try {
    const res = await fetch(`${BASE}/api_customer_order_product_insert2`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-CSRF-TOKEN": sess.csrf,
        "X-Requested-With": "XMLHttpRequest",
        Cookie: sess.cookie,
        Origin: BASE,
        Referer: `${BASE}/order_insert2?key=${chaeumchaeKey()}`,
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
// 출고일은 페이지가 심어준 order_day를 우선(없으면 인자 fallback).
export async function submitChaeumchae(
  orderDayFallback: string,
  items: SubmitItem[],
): Promise<{ orderDay: string; results: SubmitResult[] }> {
  const sess = await fetchSession();
  const orderDay = sess.orderDay || orderDayFallback;
  const results: SubmitResult[] = [];
  for (const it of items) {
    // 순차 호출 (같은 세션/주문에 쌓이므로)
    results.push(await insertProduct(sess, orderDay, it));
  }
  return { orderDay, results };
}

// 읽기 전용 — 현재 채움채에 잡혀 있는 그 출고일의 주문 상태(품목별 box/ea 수량). 발주를 넣지 않는다.
// 자동제출 검증/모니터링용.
export type ChaeumchaeState = {
  orderDay: string;
  orderState: string; // "" 미완료 | "3" 완료
  rows: { seq: string; name: string; box: number; ea: number }[];
};
export async function fetchChaeumchaeState(): Promise<ChaeumchaeState> {
  const sess = await fetchSession();
  const body = new URLSearchParams({
    customer_seq: CUSTOMER_SEQ,
    order_day: sess.orderDay,
  });
  const res = await fetch(`${BASE}/api_internet_order_product_list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-CSRF-TOKEN": sess.csrf,
      "X-Requested-With": "XMLHttpRequest",
      Cookie: sess.cookie,
      Referer: `${BASE}/order_insert2?key=${chaeumchaeKey()}`,
      "User-Agent": UA,
    },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as {
    extend?: { order_state?: string }[];
    body?: { product_seq?: string; product_name?: string; box_qty?: number; ea_qty?: number }[];
  } | null;
  return {
    orderDay: sess.orderDay,
    orderState: json?.extend?.[0]?.order_state ?? "",
    rows: (json?.body ?? []).map((r) => ({
      seq: String(r.product_seq ?? ""),
      name: String(r.product_name ?? ""),
      box: Number(r.box_qty ?? 0),
      ea: Number(r.ea_qty ?? 0),
    })),
  };
}
