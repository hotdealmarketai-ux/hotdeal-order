import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { getHoldsOverview } from "@/lib/holds";

// 담기 현황 실시간 폴링 — 관리자만. no-store.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json(
      { error: "forbidden" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }
  const data = await getHoldsOverview();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
