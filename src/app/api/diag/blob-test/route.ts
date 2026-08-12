import { put } from "@vercel/blob";
import { NextResponse } from "next/server";

// ⚠️ 임시 진단 라우트 — 미디어 업로드(Vercel Blob) 토큰·스토어 검증용. 확인 후 삭제 예정.
// 비밀키 게이트(무단 접근 차단). 토큰 값 자체는 노출하지 않고 존재/길이만 반환.
export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<NextResponse> {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== "hdo-blobdiag-9f3k2q") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const token = process.env.BLOB_READ_WRITE_TOKEN || "";
  const info = {
    hasToken: !!token,
    tokenLen: token.length,
    tokenPrefix: token.slice(0, 14), // vercel_blob_rw_ 형식 확인용(비밀 아님)
    storeId: process.env.BLOB_STORE_ID || null,
  };
  try {
    const blob = await put(
      "diag/blob-test.txt",
      "diagnostic ok",
      { access: "public", addRandomSuffix: true, contentType: "text/plain" },
    );
    return NextResponse.json({ ok: true, ...info, url: blob.url });
  } catch (e) {
    return NextResponse.json(
      { ok: false, ...info, error: e instanceof Error ? e.message : String(e) },
      { status: 200 },
    );
  }
}
