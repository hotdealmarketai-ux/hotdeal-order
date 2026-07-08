// 구조화 에러 로깅 — 실패가 조용히 사라지지 않도록 한 곳에서 기록한다.
// Vercel 런타임 로그에서 "[err]"로 검색 가능(scope·message·context가 한 줄 JSON).
// 외부 추적(Sentry 등)을 붙일 땐 이 함수 한 곳에만 연결하면 앱 전체에 반영된다.
type Ctx = Record<string, unknown>;

export function logError(scope: string, err: unknown, ctx?: Ctx): void {
  const payload: Record<string, unknown> = {
    scope,
    message: err instanceof Error ? err.message : String(err),
    ...(ctx ?? {}),
  };
  if (err instanceof Error && err.stack) {
    payload.stack = err.stack.split("\n").slice(0, 3).join(" | ");
  }
  const status = (err as { status?: number; statusCode?: number })?.status ??
    (err as { statusCode?: number })?.statusCode;
  if (status != null) payload.status = status;

  try {
    console.error(`[err] ${scope} ${JSON.stringify(payload)}`);
  } catch {
    // JSON 직렬화 실패해도 최소한은 남긴다
    console.error(`[err] ${scope}`, payload);
  }

  // 추후 확장 지점: SENTRY_DSN 설정 시 여기서 Sentry.captureException(err, { tags:{scope}, extra:ctx })
}
