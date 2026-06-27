import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// 임시: 전체 발주 내역 초기화. 새롭(ADMIN_SAEROP) 세션에서만 동작. 사용 후 제거 예정.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN_SAEROP") {
    return new Response("forbidden", { status: 403 });
  }
  const result = await prisma.order.deleteMany({});
  const url = new URL("/admin", request.url);
  url.searchParams.set("reset", String(result.count));
  return Response.redirect(url, 303);
}
