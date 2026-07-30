import { NextResponse } from "next/server";
import { snapshotWarehouseStock } from "@/lib/warehouse-stock";
import { logError } from "@/lib/log";

// 창고 실물재고 스냅샷 — 출고 끝난 오전 10시(KST)에 tick 크론이 호출. 재고현황(base)을 창고 수량으로 반영.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return new Response("forbidden", { status: 403 });
  }
  try {
    const count = await snapshotWarehouseStock();
    return NextResponse.json({ ok: true, count });
  } catch (e) {
    logError("warehouse-stock-sync", e, {});
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
