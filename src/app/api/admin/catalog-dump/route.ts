import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { prisma } from "@/lib/prisma";

// ⚠ 임시(1회성) 읽기전용 — 재고현황(실재고)+채움채 상품 단가표 엑셀용. 조회 후 제거.
// SELECT 만. 관리자 세션 필수.
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  const [inventory, chaeumchae] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        name: true,
        qty: true,
        supplyPrice: true,
        majorCat: true,
        minorCat: true,
        tax: true,
      },
    }),
    prisma.chaeumchaeProduct.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: {
        seq: true,
        name: true,
        hasBox: true,
        perBox: true,
        piecePrice: true,
        unit: true,
        tax: true,
      },
    }),
  ]);
  return NextResponse.json(
    { ok: true, invCount: inventory.length, chaeCount: chaeumchae.length, inventory, chaeumchae },
    { headers: { "Cache-Control": "no-store" } },
  );
}
