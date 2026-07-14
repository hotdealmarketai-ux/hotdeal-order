import { safePushInventory, inventoryPushPending } from "@/lib/inventory-sheet";

// R3 재고 동기화는 '단방향(앱→시트)'. 앱 DB가 기준이고, 시트는 앱 변경분을 반영하는 미러다.
// tick 디스패처가 매 분 호출 → 앱에서 변경(추가/수정/삭제)이 있었을 때만(pending) DB 전체를 시트에 재작성.
// (시트에서 직접 고친 내용은 되가져오지 않는다 — 모든 추가/수정/삭제는 앱에서.)
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  // 변경분이 없으면 시트를 건드리지 않는다(불필요한 재작성 방지).
  if (!(await inventoryPushPending())) {
    return Response.json({ ok: true, skipped: true });
  }
  const r = await safePushInventory(); // 성공 시 pending 해제
  return Response.json(r);
}
