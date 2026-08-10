// ⚠ 임시 진단 라우트(관리자 게이트) — tick after() 백그라운드 실행 검증용. 확인 후 즉시 삭제.
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/session";
import { isAdmin, type Role } from "@/lib/constants";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role as Role)) {
    return new Response("forbidden", { status: 403 });
  }
  const rows = await prisma.appMeta.findMany({
    where: { OR: [{ key: { startsWith: "tick:" } }, { key: { contains: "chaeumchae" } }, { key: { contains: "sourcing" } }] },
    orderBy: { syncedAt: "desc" },
  });
  return Response.json({
    ok: true,
    nowKst: new Date(Date.now() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16) + " KST",
    rows: rows.map((r) => ({
      key: r.key,
      syncedKst: r.syncedAt
        ? new Date(r.syncedAt.getTime() + 9 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16) + " KST"
        : null,
    })),
  });
}
