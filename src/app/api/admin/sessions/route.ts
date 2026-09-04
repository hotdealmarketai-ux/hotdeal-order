import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { listMerchantSessions } from "@/lib/user-session";

// 관리자 '로그인 현황' 폴링 소스 — 가맹점별 활성 세션(기기) 목록.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ groups: [] }, { status: 403 });
  }
  const groups = await listMerchantSessions();
  return NextResponse.json(
    { groups, now: Date.now() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
