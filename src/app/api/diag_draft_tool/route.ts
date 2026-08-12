import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";

// [임시 진단 라우트 — 재고조사표 '나갈 수량' 차감용, 사용 후 즉시 삭제]
// 관리자 세션(ADMIN_SAEROP)만 접근. 읽기전용.
// 반환:
//  - inventory: 현재 재고행 {name, qty, majorCat, minorCat, sortOrder} (같은 시점 스냅샷)
//  - outgoing:  DRAFT·DAILY 계산서 중 공구(TOOL)가 '확정된'(confirmedCats⊇TOOL) 계산서의 TOOL 품목을 이름별 합산
//  - drafts:    투명성용 계산서별 내역 {store, date, confirmedCats, tools:[{name,qty}]}
// 차감 로직과 동일하게 category="TOOL" 을 이름별로 합산한다(발행 시 재고 차감이 그렇게 동작).
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN_SAEROP") {
    return new Response("forbidden", { status: 403 });
  }

  const [items, drafts] = await Promise.all([
    prisma.inventoryItem.findMany({
      where: { deletedAt: null },
      select: { name: true, qty: true, majorCat: true, minorCat: true, sortOrder: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.invoice.findMany({
      where: { kind: "DAILY", status: "DRAFT" },
      select: {
        id: true,
        date: true,
        confirmedCats: true,
        user: { select: { storeName: true } },
        items: {
          where: { category: "TOOL" },
          select: { name: true, qty: true, inventoryItemId: true },
        },
      },
    }),
  ]);

  const outMap = new Map<string, number>();
  const draftReport: {
    store: string;
    date: string;
    confirmedCats: string;
    toolConfirmed: boolean;
    tools: { name: string; qty: number }[];
  }[] = [];

  for (const inv of drafts) {
    const toolConfirmed = inv.confirmedCats
      .split(",")
      .map((s) => s.trim())
      .includes("TOOL");
    const tools = inv.items
      .map((it) => ({ name: it.name.trim(), qty: Math.round(it.qty) }))
      .filter((t) => t.name && t.qty > 0);
    draftReport.push({
      store: inv.user.storeName,
      date: inv.date,
      confirmedCats: inv.confirmedCats,
      toolConfirmed,
      tools,
    });
    if (!toolConfirmed) continue; // '확정된 것만' — TOOL 미확정 초안은 제외
    for (const t of tools) outMap.set(t.name, (outMap.get(t.name) ?? 0) + t.qty);
  }

  const outgoing = [...outMap.entries()].map(([name, qty]) => ({ name, qty }));

  return NextResponse.json(
    {
      generatedNote: "DRAFT DAILY, TOOL confirmed only",
      inventoryCount: items.length,
      draftCount: drafts.length,
      confirmedDraftCount: draftReport.filter((d) => d.toolConfirmed).length,
      outgoing,
      inventory: items,
      drafts: draftReport,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
