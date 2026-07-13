// Google 서비스계정 인증 — RS256 JWT를 직접 서명해 액세스 토큰을 발급(무거운 SDK 없이 Node crypto만).
// 크레덴셜은 환경변수로만 주입(레포에 절대 커밋 금지):
//   GOOGLE_SERVICE_ACCOUNT_B64 = 서비스계정 JSON 전체를 base64 인코딩한 값(권장, 한 줄)
//   또는 GOOGLE_SERVICE_ACCOUNT_JSON = 원문 JSON 문자열
import crypto from "node:crypto";

type ServiceAccount = { client_email: string; private_key: string };

let saCache: ServiceAccount | null | undefined;

export function getServiceAccount(): ServiceAccount | null {
  if (saCache !== undefined) return saCache;
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_B64;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  let json = "";
  if (b64) {
    try {
      json = Buffer.from(b64, "base64").toString("utf8");
    } catch {
      json = "";
    }
  } else if (raw) {
    json = raw;
  }
  if (!json) {
    saCache = null;
    return null;
  }
  try {
    const o = JSON.parse(json);
    if (o.client_email && o.private_key) {
      saCache = { client_email: o.client_email, private_key: o.private_key };
      return saCache;
    }
  } catch {
    // fallthrough
  }
  saCache = null;
  return null;
}

export function hasGoogleCreds(): boolean {
  return getServiceAccount() !== null;
}

const b64url = (b: Buffer | string) =>
  Buffer.from(b).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

let tokenCache: { token: string; exp: number; scope: string } | null = null;

// 서비스계정 JWT → OAuth2 액세스 토큰. 토큰은 만료 전까지 메모리 캐시(스코프별).
export async function getGoogleAccessToken(scope: string): Promise<string> {
  const sa = getServiceAccount();
  if (!sa) throw new Error("no-service-account");
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.scope === scope && tokenCache.exp > now + 60) {
    return tokenCache.token;
  }
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  );
  const input = `${header}.${claim}`;
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(input);
  const jwt = `${input}.${b64url(signer.sign(sa.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8000), // 관리자 액션이 구글 지연에 매달리지 않도록
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) {
    throw new Error(`google token ${res.status}: ${JSON.stringify(j)}`);
  }
  tokenCache = {
    token: j.access_token,
    exp: now + (typeof j.expires_in === "number" ? j.expires_in : 3600),
    scope,
  };
  return j.access_token;
}
