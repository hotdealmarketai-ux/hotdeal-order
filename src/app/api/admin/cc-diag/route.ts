// ⚠⚠ 임시 진단 라우트 — 채움채 크론 상태(AppMeta) 점검용. 확인 후 즉시 삭제.
// 관리자 세션 게이트.
//   ?do=list (기본)        — chaeumchae 관련 AppMeta 키 전부 조회(claim·tick 마지막 실행시각).
//   ?do=unclaim&key=<키>   — 막힌 dedup claim 1건 삭제(다음 크론이 다시 제출하게 함).
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isAdmin, type Role } from "@/lib/constants";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role as Role)) {
    return new Response("forbidden", { status: 403 });
  }
  const url = new URL(request.url);
  const doParam = (url.searchParams.get("do") || "list").toLowerCase();

  if (doParam === "unclaim") {
    const key = url.searchParams.get("key") || "";
    if (!key.startsWith("chaeumchae:")) {
      return Response.json({ ok: false, error: "chaeumchae: 로 시작하는 키만 삭제 가능" }, { status: 400 });
    }
    const del = await prisma.appMeta.deleteMany({ where: { key } });
    return Response.json({ ok: true, deleted: del.count, key });
  }

  const rows = await prisma.appMeta.findMany({
    where: {
      OR: [
        { key: { contains: "chaeumchae" } },
        { key: { startsWith: "tick:chaeumchae" } },
        { key: { startsWith: "tick:deadline" } },
      ],
    },
    orderBy: { key: "asc" },
  });
  return Response.json({
    ok: true,
    now: new Date().toISOString(),
    rows: rows.map((r) => ({ key: r.key, syncedAt: r.syncedAt?.toISOString() ?? null })),
  });
}
