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
    // 카테고리 선택지 — 재고현황 품목의 대분류/중분류 조합에서 도출.
    prisma.inventoryItem.findMany({
      where: { deletedAt: null, majorCat: { not: "" } },
      select: { majorCat: true, minorCat: true },
      distinct: ["majorCat", "minorCat"],
      orderBy: [{ majorCat: "asc" }, { minorCat: "asc" }],
    }),
  ]);

  // 대분류 → 중분류[] 트리(중분류는 빈값 제외).
  const treeMap = new Map<string, string[]>();
  for (const r of catRows) {
    if (!r.majorCat) continue;
    const minors = treeMap.get(r.majorCat) ?? [];
    if (r.minorCat && !minors.includes(r.minorCat)) minors.push(r.minorCat);
    treeMap.set(r.majorCat, minors);
  }
  const catTree = [...treeMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ko"))
    .map(([major, minors]) => ({
      major,
      minors: minors.sort((a, b) => a.localeCompare(b, "ko")),
    }));

  return (
    <>
      <Topbar brand="새롭 · 관리자" right={<TopbarChip>{user.storeName}</TopbarChip>} />
      <div className="page">
        <InboundManager initialRows={logs.map(toInboundRow)} catTree={catTree} />
      </div>
    </>
  );
}
