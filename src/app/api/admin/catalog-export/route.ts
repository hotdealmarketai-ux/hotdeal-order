// ⚠ 임시(1회성) 관리자 조회 라우트 — 취급 제품 목록(재고≥1 + 채움채 + 주간발주) 내보내기용.
// 읽기 전용·관리자 세션 게이트. 파일 뽑은 뒤 제거한다.
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { isAdmin } from "@/lib/constants";
import { prisma } from "@/lib/prisma";
import { WEEKLY_CATALOG, boxWord } from "@/lib/weekly-catalog";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 403 });
  }

  const inventory = await prisma.inventoryItem.findMany({
    where: { deletedAt: null, qty: { gte: 1 } },
    select: {
      name: true,
      qty: true,
      supplyPrice: true,
      majorCat: true,
      minorCat: true,
      tax: true,
    },
    orderBy: [
      { majorCat: "asc" },
      { minorCat: "asc" },
      { sortOrder: "asc" },
      { name: "asc" },
    ],
  });

  return NextResponse.json({
    counts: {
      inventory: inventory.length,
      weekly: WEEKLY_CATALOG.length,
      chaeumchae: CHAEUMCHAE_CATALOG.length,
    },
    inventory,
    weekly: WEEKLY_CATALOG.map((w) => ({
      name: w.name,
      boxUnit: w.boxUnit,
      boxPrice: w.boxPrice,
      unitWord: boxWord(w.category),
    })),
    chaeumchae: CHAEUMCHAE_CATALOG.map((c) => ({ name: c.name })),
  });
}
