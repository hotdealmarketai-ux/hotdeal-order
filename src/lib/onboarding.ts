// 튜토리얼(편집형) — 게이트·진행률·트리 로더.
// 진행률 = 체크한 체크박스 수 / 전체 체크박스 수. 100%면 onboardingCompletedAt 세팅 → 발주 오픈.
// 게이트는 startedAt/completedAt 만 본다 → 기존 점주(startedAt=null)는 절대 잠기지 않음.
import { prisma } from "@/lib/prisma";

export const BLOCK_TYPES = ["HEADING", "TEXT", "IMAGE", "CHECK"] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export type NodeBlock = {
  id: string;
  order: number;
  type: string; // HEADING | TEXT | IMAGE | CHECK
  text: string;
  imageUrl: string;
  colSpan: number; // 1..12
};

export type ChildNode = { id: string; title: string; order: number };
export type Crumb = { id: string; title: string };

export type NodeLoad = {
  node: { id: string; title: string; parentId: string | null };
  breadcrumb: Crumb[]; // 루트(대분류)부터 현재까지
  level: number; // 1=대, 2=중, 3=소
  children: ChildNode[];
  blocks: NodeBlock[];
};

export type ProgressView = {
  total: number; // 전체 체크박스 수
  done: number; // 체크된 수
  percent: number; // 0~100
  complete: boolean; // total>0 && done>=total
};

// 온보딩 게이트 대상인가 — 핫딜마켓 & 승인 & 시작됨 & 아직 미완료.
export function needsOnboarding(user: {
  role: string;
  status: string;
  onboardingStartedAt: Date | null;
  onboardingCompletedAt: Date | null;
}): boolean {
  return (
    user.role === "MERCHANT_HOTDEAL" &&
    user.status === "APPROVED" &&
    user.onboardingStartedAt != null &&
    user.onboardingCompletedAt == null
  );
}

// 진행률 — 전체 체크박스 대비 그 점주가 체크한 수.
export async function getProgress(userId: string): Promise<ProgressView> {
  const [total, done] = await Promise.all([
    prisma.onboardingBlock.count({ where: { type: "CHECK" } }),
    prisma.onboardingCheck.count({ where: { userId, block: { type: "CHECK" } } }),
  ]);
  // 체크박스가 하나도 없으면(초기 구성 중/빈 템플릿) 잠글 게 없으므로 완료로 본다.
  const percent = total === 0 ? 100 : Math.min(100, Math.round((done / total) * 100));
  return { total, done, percent, complete: total === 0 ? true : done >= total };
}

// 완료 판정 — 전체 체크박스를 다 체크했으면 onboardingCompletedAt 세팅(멱등, sticky).
// 방금 완료됐으면 true. 완료 후 관리자가 체크박스를 추가해도 completedAt은 유지(발주 계속 오픈).
export async function maybeCompleteOnboarding(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { onboardingStartedAt: true, onboardingCompletedAt: true },
  });
  if (!user || user.onboardingStartedAt == null || user.onboardingCompletedAt != null) {
    return false;
  }
  const p = await getProgress(userId);
  if (!p.complete) return false;
  await prisma.user.update({
    where: { id: userId },
    data: { onboardingCompletedAt: new Date() },
  });
  return true;
}

// 대분류(최상위) 목록.
export async function getRootNodes(): Promise<ChildNode[]> {
  return prisma.onboardingNode.findMany({
    where: { parentId: null },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, title: true, order: true },
  });
}

// 루트→현재까지의 경로(브레드크럼). 깊이 ≤ 3이라 짧은 루프.
export async function getBreadcrumb(nodeId: string): Promise<Crumb[]> {
  const chain: Crumb[] = [];
  let cur = await prisma.onboardingNode.findUnique({
    where: { id: nodeId },
    select: { id: true, title: true, parentId: true },
  });
  let guard = 0;
  while (cur && guard++ < 10) {
    chain.unshift({ id: cur.id, title: cur.title });
    if (!cur.parentId) break;
    cur = await prisma.onboardingNode.findUnique({
      where: { id: cur.parentId },
      select: { id: true, title: true, parentId: true },
    });
  }
  return chain;
}

// 한 노드의 자식·블록·경로. 없으면 null.
export async function loadNode(nodeId: string): Promise<NodeLoad | null> {
  const node = await prisma.onboardingNode.findUnique({
    where: { id: nodeId },
    select: { id: true, title: true, parentId: true },
  });
  if (!node) return null;
  const [children, blocks, breadcrumb] = await Promise.all([
    prisma.onboardingNode.findMany({
      where: { parentId: nodeId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, title: true, order: true },
    }),
    prisma.onboardingBlock.findMany({
      where: { nodeId },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, order: true, type: true, text: true, imageUrl: true, colSpan: true },
    }),
    getBreadcrumb(nodeId),
  ]);
  return { node, breadcrumb, level: breadcrumb.length, children, blocks };
}

// 템플릿 전체 체크박스를 분류 경로와 함께 평면으로(관리자 점포별 확인용).
export type CheckBlockFlat = { id: string; text: string; path: string };
export async function getAllCheckBlocks(): Promise<CheckBlockFlat[]> {
  const [nodes, blocks] = await Promise.all([
    prisma.onboardingNode.findMany({
      select: { id: true, title: true, parentId: true },
    }),
    prisma.onboardingBlock.findMany({
      where: { type: "CHECK" },
      orderBy: [{ order: "asc" }, { createdAt: "asc" }],
      select: { id: true, text: true, nodeId: true, order: true },
    }),
  ]);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pathOf = (nodeId: string) => {
    const parts: string[] = [];
    let cur: (typeof nodes)[number] | undefined = byId.get(nodeId);
    let guard = 0;
    while (cur && guard++ < 10) {
      parts.unshift(cur.title || "(제목 없음)");
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };
  return blocks
    .map((b) => ({ id: b.id, text: b.text, path: pathOf(b.nodeId), order: b.order }))
    .sort((a, b) => a.path.localeCompare(b.path, "ko") || a.order - b.order)
    .map(({ id, text, path }) => ({ id, text, path }));
}

// 그 점주가 체크한 blockId 집합(주어진 후보 중).
export async function getUserChecks(
  userId: string,
  blockIds: string[],
): Promise<Set<string>> {
  if (blockIds.length === 0) return new Set();
  const rows = await prisma.onboardingCheck.findMany({
    where: { userId, blockId: { in: blockIds } },
    select: { blockId: true },
  });
  return new Set(rows.map((r) => r.blockId));
}
