import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { toInboundRow } from "@/lib/inbound";
import { InboundManager } from "@/components/InboundManager";

export const dynamic = "force-dynamic";

// 입고 — 실시간 입고 기록 + 재고현황 반영. 상단 입력폼 / 하단 기록목록(검색·스크롤·삭제).
export default async function InboundPage() {
  const user = await requireAdmin();

  const [logs, catRows] = await Promise.all([
    // 최근 입고 기록(스크롤 창). 전체 기록은 검색으로 조회.
    prisma.inboundLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }),
    // 카테고리 선택지 — 재고현황 품목에 붙은 대분류에서 도출(빈값 제외).
    prisma.inventoryItem.findMany({
      where: { deletedAt: null, majorCat: { not: "" } },
      select: { majorCat: true },
      distinct: ["majorCat"],
      orderBy: { majorCat: "asc" },
    }),
  ]);
  const categories = [...new Set(catRows.map((c) => c.majorCat).filter(Boolean))];

  return (
    <>
      <Topbar brand="새롭 · 관리자" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <h1 className="h1">입고</h1>
        <InboundManager initialRows={logs.map(toInboundRow)} categories={categories} />
      </div>
    </>
  );
}
