// ⚠ 1회성 진단 엔드포인트 — 팝빌 계좌조회(collectDeposits)를 즉시 실행하고 결과/오류를 JSON으로 반환.
//   운영전환 후 왜 수집이 안 되는지(오류 메시지) 확인용. 관리자 세션 가드. 확인 후 즉시 제거.
import { collectDeposits } from "@/lib/bank";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";

export const maxDuration = 60; // 팝빌 잡 폴링(최대 ~30초) 대기

export async function GET() {
  const me = await getCurrentUser();
  if (!me || !isAdmin(me.role)) {
    return Response.json({ ok: false, error: "관리자 로그인 필요" }, { status: 403 });
  }
  try {
    const result = await collectDeposits(3);
    return Response.json({ ok: result.errors.length === 0, result });
  } catch (err) {
    return Response.json({ ok: false, error: (err as Error)?.message ?? String(err) }, { status: 200 });
  }
}
