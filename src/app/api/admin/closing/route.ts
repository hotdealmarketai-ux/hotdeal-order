import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { buildClosingWorkbook, writeClosingLog } from "@/lib/closing";

// 마감 백업 xlsx 다운로드 — 관리자 전용(POST: 로그를 남기는 부수효과가 있어 GET 아님). no-store.
export const runtime = "nodejs"; // exceljs + prisma는 Node 런타임 필수(엣지 금지)
export const dynamic = "force-dynamic";
export const maxDuration = 60; // 백업 데이터가 커져도 여유(플랜 상한까지 적용)

function kstStamp(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}${p(kst.getUTCMonth() + 1)}${p(kst.getUTCDate())}-${p(kst.getUTCHours())}${p(kst.getUTCMinutes())}`;
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role) || user.status !== "APPROVED") {
    return new Response("forbidden", {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  const now = new Date();
  // ?months=N → 상세(출고·원장) 시트를 최근 N개월로 제한(요약·미수·재고는 전체). 없으면 전체.
  const mParam = new URL(req.url).searchParams.get("months");
  const months = mParam && /^\d+$/.test(mParam) ? Math.min(120, parseInt(mParam, 10)) : null;
  const { buffer, summary } = await buildClosingWorkbook(now, months);
  await writeClosingLog({ id: user.id, storeName: user.storeName }, summary);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="magam-${kstStamp(now)}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
