import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { fetchLatestArtifactZip } from "@/lib/github-backup";

// 최신 백업 아티팩트(zip) 다운로드 — 관리자 전용. ?kind=db|media
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role) || user.status !== "APPROVED") {
    return new Response("forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  }
  const kind = new URL(req.url).searchParams.get("kind") === "media" ? "media" : "db";
  const out = await fetchLatestArtifactZip(kind);
  if (!out) {
    return new Response("백업 파일을 찾을 수 없어요 (토큰/권한 미설정 또는 아티팩트 없음).", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return new Response(new Uint8Array(out.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${out.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
