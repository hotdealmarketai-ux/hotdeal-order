import { syncInventoryFromSheet } from "@/lib/inventory-sheet";

// #12 재고 구글시트 → DB 동기화. tick 디스패처가 매 분 호출(시트=기준). CRON_SECRET 인증.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  const r = await syncInventoryFromSheet();
  return Response.json(r);
}
