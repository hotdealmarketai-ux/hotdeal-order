import { safePushInventory } from "@/lib/inventory-sheet";

// R3 재고 동기화는 '단방향(앱→시트)'. 앱 DB가 기준이고, 시트는 앱 변경분을 반영하는 미러다.
// tick 디스패처가 매 분 호출 → DB 전체를 시트에 항상 재작성(clear→A1:C). '그냥 계속 시트로 보내기'.
// 이렇게 하면 어떤 이유로든 시트가 DB와 어긋나도(외부 편집·사고) 다음 회차에 자동 복구(self-heal)된다.
// (시트에서 직접 고친 내용은 되가져오지 않는다 — 모든 추가/수정/삭제는 앱에서.)
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  const r = await safePushInventory();
  return Response.json(r);
}
