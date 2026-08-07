// 튜토리얼(오픈 준비) — 분류 트리 = 체크박스. 최하위(자식 없는) 노드만 실제 체크 대상.
// 점주가 누르면 '승인 대기', 관리자가 승인하면 '활성(완료)'. 하위가 모두 완료면 상위가 롤업 완료.
// 진행률 = 승인된 최하위 / 전체 최하위. 100%면 발주 오픈. 게이트는 startedAt/completedAt 만 본다.
import { prisma } from "@/lib/prisma";

export type RawNode = {
  id: string;
  parentId: string | null;
  order: number;
  title: string;
  description: string;
  images: string[];
};

export type TreeNode = RawNode & { children: TreeNode[]; isLeaf: boolean };

// 한 노드의 지점별 상태.
export type NodeState = {
  complete: boolean; // 완료(활성). 최하위=승인됨 / 상위=모든 자식 완료
  pending: boolean; // 최하위=승인 대기 / 상위=진행 중이나 미완료
};

export type ProgressView = {
  total: number; // 전체 최하위(체크 대상) 수
  done: number; // 승인 완료된 최하위 수
  percent: number;
  complete: boolean;
};

// 게이트 대상 — 핫딜마켓 & 승인 & 시작됨 & 미완료.
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

async function loadAllNodes(): Promise<RawNode[]> {
  return prisma.onboardingNode.findMany({
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
    select: { id: true, parentId: true, order: true, title: true, description: true, images: true },
  });
}

function buildTree(nodes: RawNode[]) {
  const byId = new Map<string, TreeNode>();
  for (const n of nodes) byId.set(n.id, { ...n, children: [], isLeaf: true });
  const roots: TreeNode[] = [];
  for (const n of nodes) {
    const node = byId.get(n.id)!;
    if (n.parentId && byId.get(n.parentId)) {
      const p = byId.get(n.parentId)!;
      p.children.push(node);
      p.isLeaf = false;
    } else {
      roots.push(node);
    }
  }
  return { roots, byId };
}

function leavesOf(byId: Map<string, TreeNode>): TreeNode[] {
  return [...byId.values()].filter((n) => n.isLeaf);
}

// 진행률 — 승인된 최하위 / 전체 최하위.
export async function getProgress(userId: string): Promise<ProgressView> {
  const { byId } = buildTree(await loadAllNodes());
  const leaves = leavesOf(byId);
  const total = leaves.length;
  if (total === 0) return { total: 0, done: 0, percent: 100, complete: true };
  const approved = await prisma.onboardingApproval.findMany({
    where: { userId, approvedAt: { not: null } },
    select: { nodeId: true },
  });
  const approvedSet = new Set(approved.map((a) => a.nodeId));
  const done = leaves.filter((n) => approvedSet.has(n.id)).length;
  const percent = Math.min(100, Math.floor((done / total) * 100));
  return { total, done, percent, complete: done >= total };
}

// 완료 판정(멱등, sticky). 승인된 최하위가 전부면 completedAt 세팅.
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

// 전체 최하위(체크 대상) 개수 — 시작 가드용.
export async function countLeaves(): Promise<number> {
  const { byId } = buildTree(await loadAllNodes());
  return leavesOf(byId).length;
}

// 트리 + 지점별 롤업 상태(점주/관리자 뷰).
export async function getTreeWithState(userId: string): Promise<{
  roots: TreeNode[];
  state: Map<string, NodeState>;
  progress: ProgressView;
}> {
  const { roots, byId } = buildTree(await loadAllNodes());
  const approvals = await prisma.onboardingApproval.findMany({
    where: { userId },
    select: { nodeId: true, approvedAt: true },
  });
  const appByNode = new Map(approvals.map((a) => [a.nodeId, a]));
  const state = new Map<string, NodeState>();

  const compute = (node: TreeNode): NodeState => {
    let st: NodeState;
    if (node.isLeaf) {
      const a = appByNode.get(node.id);
      st = { complete: !!a?.approvedAt, pending: !!a && !a.approvedAt };
    } else {
      const cs = node.children.map(compute);
      const complete = node.children.length > 0 && cs.every((s) => s.complete);
      const pending = !complete && cs.some((s) => s.complete || s.pending);
      st = { complete, pending };
    }
    state.set(node.id, st);
    return st;
  };
  roots.forEach(compute);

  const leaves = leavesOf(byId);
  const total = leaves.length;
  const done = leaves.filter((n) => state.get(n.id)?.complete).length;
  const percent = total === 0 ? 100 : Math.min(100, Math.floor((done / total) * 100));
  return { roots, state, progress: { total, done, percent, complete: total === 0 ? true : done >= total } };
}

// 관리자 점포별 승인 화면 — 전체 최하위 + 경로 + 그 지점 상태(요청/승인).
export type LeafApproval = {
  id: string;
  title: string;
  path: string; // 상위 분류 경로(자기 제외)
  requestedAt: Date | null;
  approvedAt: Date | null;
};
export async function getLeafApprovals(userId: string): Promise<LeafApproval[]> {
  const nodes = await loadAllNodes();
  const { byId } = buildTree(nodes);
  const leaves = leavesOf(byId);
  const approvals = await prisma.onboardingApproval.findMany({
    where: { userId },
    select: { nodeId: true, requestedAt: true, approvedAt: true },
  });
  const appByNode = new Map(approvals.map((a) => [a.nodeId, a]));
  const pathOf = (node: TreeNode) => {
    const parts: string[] = [];
    let cur: TreeNode | undefined = node.parentId ? byId.get(node.parentId) : undefined;
    let g = 0;
    while (cur && g++ < 10) {
      parts.unshift(cur.title || "(제목 없음)");
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return parts.join(" › ");
  };
  // 트리 순서(대→소)를 유지하기 위해 DFS로 최하위 수집.
  const ordered: TreeNode[] = [];
  const dfs = (n: TreeNode) => {
    if (n.isLeaf) ordered.push(n);
    else n.children.forEach(dfs);
  };
  buildTree(nodes).roots.forEach(dfs);
  return ordered.map((n) => {
    const a = appByNode.get(n.id);
    return {
      id: n.id,
      title: n.title,
      path: pathOf(byId.get(n.id)!),
      requestedAt: a?.requestedAt ?? null,
      approvedAt: a?.approvedAt ?? null,
    };
  });
}

// 대분류(루트) 목록 — 편집기용.
export async function getRootNodes(): Promise<
  { id: string; title: string; order: number; isLeaf: boolean }[]
> {
  const { roots, byId } = buildTree(await loadAllNodes());
  return roots.map((r) => ({ id: r.id, title: r.title, order: r.order, isLeaf: byId.get(r.id)!.isLeaf }));
}

export type Crumb = { id: string; title: string };
export type NodeEdit = {
  node: { id: string; title: string; description: string; images: string[]; parentId: string | null };
  breadcrumb: Crumb[];
  level: number; // 1=대,2=중,3=소
  children: { id: string; title: string; order: number; isLeaf: boolean }[];
};

// 편집기 — 한 노드(설명·이미지) + 자식 + 경로.
export async function loadNode(nodeId: string): Promise<NodeEdit | null> {
  const nodes = await loadAllNodes();
  const { byId } = buildTree(nodes);
  const cur = byId.get(nodeId);
  if (!cur) return null;
  const breadcrumb: Crumb[] = [];
  let walk: TreeNode | undefined = cur;
  let g = 0;
  while (walk && g++ < 10) {
    breadcrumb.unshift({ id: walk.id, title: walk.title });
    walk = walk.parentId ? byId.get(walk.parentId) : undefined;
  }
  const children = cur.children.map((c) => ({
    id: c.id,
    title: c.title,
    order: c.order,
    isLeaf: c.isLeaf,
  }));
  return {
    node: {
      id: cur.id,
      title: cur.title,
      description: cur.description,
      images: cur.images,
      parentId: cur.parentId,
    },
    breadcrumb,
    level: breadcrumb.length,
    children,
  };
}

// 노드가 최하위(체크 대상)인지 — 서버 액션 가드용.
export async function isLeafNode(nodeId: string): Promise<boolean> {
  const has = await prisma.onboardingNode.count({ where: { parentId: nodeId } });
  return has === 0;
}
