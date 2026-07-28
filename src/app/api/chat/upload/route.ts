import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isMerchant } from "@/lib/constants";

// #2 채팅 사진·영상 첨부 — 클라이언트 직접 업로드(대용량 영상 대비, 서버리스 본문 4.5MB 제한 우회).
// 클라 upload()가 이 라우트로 토큰을 요청 → 승인된 사용자만, image/*·video/*만, 100MB 이하.
// 업로드 성공 후 클라가 받은 URL을 sendChat로 넘겨 메시지를 만든다(서버 콜백 불필요).
export const dynamic = "force-dynamic";

const ADMIN = "ADMIN_SAEROP";

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getCurrentUser();
  const allowed =
    !!user &&
    user.status === "APPROVED" &&
    (user.role === ADMIN || isMerchant(user.role));
  if (!allowed) {
    return NextResponse.json({ error: "권한이 없어요." }, { status: 401 });
  }

  const body = (await request.json()) as HandleUploadBody;
  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/*", "video/*"],
        maximumSizeInBytes: 100 * 1024 * 1024, // 100MB
        addRandomSuffix: true,
      }),
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    // 원인 진단용 — Vercel 런타임 로그에 남긴다(토큰/OIDC 문제 파악).
    console.error("[chat/upload] handleUpload failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "업로드에 실패했어요." },
      { status: 400 },
    );
  }
}
