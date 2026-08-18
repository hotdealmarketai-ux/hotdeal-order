"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { normalizeDateStr } from "@/lib/date";
import { writeAudit } from "@/lib/audit";

// 반납 용기(아이스박스·우유 콘티 등) 회수 관리.
// 나간 수량은 별도 저장하지 않고, 계산서 공구란(InvoiceItem category=TOOL)에서 이름이 용기 matchKey 와
// 매칭(정규화 후 부분일치)되고 출고일(date)이 용기 startDate 이후인 것을 지점별로 실시간 집계한다.
// 회수는 ContainerReturn 에만 수기 기록 → 미회수 = 나감 − 회수. 재고·미수·매출과 완전 무관(0원 자산 회수용).

// 정규화: 공백 제거 + 소문자. '우유 콘티' == '우유콘티'.
const norm = (s: string) => s.replace(/\s+/g, "").toLowerCase();

export type ContainerType = {
  id: string;
  name: string;
  matchKey: string;
  startDate: string;
  sortOrder: number;
  active: boolean;
};

type ContainerRow = {
  id: string;
  name: string;
  matchKey: string;
  startDate: string;
  sortOrder: number;
  active: boolean;
};
const toType = (c: ContainerRow): ContainerType => ({
  id: c.id,
  name: c.name,
  matchKey: c.matchKey,
  startDate: c.startDate,
  sortOrder: c.sortOrder,
  active: c.active,
});

export type ContainerBranchRow = {
  userId: string;
  store: string;
  shipped: number; // 나감(계산서 집계)
  returned: number; // 회수(수기 기록 합)
  outstanding: number; // 미회수 = 나감 − 회수
};

export type ContainerBoard = {
  container: ContainerType;
  shippedTotal: number;
  returnedTotal: number;
  outstandingTotal: number;
  branches: ContainerBranchRow[];
};

// 활성(및 선택적으로 비활성 포함) 용기 종류 목록 — 탭·관리용.
export async function listContainers(
  includeInactive = false,
): Promise<ContainerType[]> {
  await requireAdmin();
  const rows = await prisma.returnableContainer.findMany({
    where: includeInactive ? {} : { active: true },
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toType);
}

// 한 용기의 지점별 나감/회수/미회수 보드.
export async function computeContainerBoard(
  containerId: string,
): Promise<ContainerBoard | null> {
  await requireAdmin();
  const c = await prisma.returnableContainer.findUnique({
    where: { id: containerId },
  });
  if (!c) return null;
  const key = norm(c.matchKey);

  // 나감: startDate 이후 발행/입금완료 계산서의 공구(TOOL) 품목 중 이름 매칭분 → 지점별 합산.
  const invoices = key
    ? await prisma.invoice.findMany({
        where: {
          date: { gte: c.startDate },
          status: { in: ["ISSUED", "PAID"] },
          items: { some: { category: "TOOL" } },
        },
        select: {
          user: { select: { id: true, storeName: true } },
          items: { where: { category: "TOOL" }, select: { name: true, qty: true } },
        },
      })
    : [];
  const shipped = new Map<string, number>();
  const storeOf = new Map<string, string>();
  for (const inv of invoices) {
    const uid = inv.user?.id;
    if (!uid) continue;
    let add = 0;
    for (const it of inv.items)
      if (norm(it.name).includes(key)) add += Math.round(it.qty || 0);
    if (add > 0) {
      shipped.set(uid, (shipped.get(uid) ?? 0) + add);
      storeOf.set(uid, inv.user!.storeName);
    }
  }

  // 회수: 이 용기의 회수 이력 지점별 합산.
  const returnAgg = await prisma.containerReturn.groupBy({
    by: ["userId"],
    where: { containerId },
    _sum: { qty: true },
  });
  const returned = new Map<string, number>();
  for (const r of returnAgg) returned.set(r.userId, r._sum.qty ?? 0);

  // 지점 합집합(나감 있거나 회수 있는 지점). 회수만 있는(startDate 밖) 지점 상호명 보충.
  const userIds = new Set<string>([...shipped.keys(), ...returned.keys()]);
  const missing = [...userIds].filter((id) => !storeOf.has(id));
  if (missing.length) {
    const users = await prisma.user.findMany({
      where: { id: { in: missing } },
      select: { id: true, storeName: true },
    });
    for (const u of users) storeOf.set(u.id, u.storeName);
  }
  const branches: ContainerBranchRow[] = [...userIds].map((id) => {
    const s = shipped.get(id) ?? 0;
    const rt = returned.get(id) ?? 0;
    return {
      userId: id,
      store: storeOf.get(id) ?? "(알 수 없음)",
      shipped: s,
      returned: rt,
      outstanding: s - rt,
    };
  });
  // 미회수 많은 순 → 상호명순.
  branches.sort(
    (a, b) => b.outstanding - a.outstanding || a.store.localeCompare(b.store, "ko"),
  );
  const shippedTotal = branches.reduce((n, r) => n + r.shipped, 0);
  const returnedTotal = branches.reduce((n, r) => n + r.returned, 0);
  return {
    container: toType(c),
    shippedTotal,
    returnedTotal,
    outstandingTotal: shippedTotal - returnedTotal,
    branches,
  };
}

export type ContainerShipEntry = { date: string; qty: number };
export type ContainerReturnEntry = {
  id: string;
  qty: number;
  memo: string;
  adminName: string;
  returnedAt: string;
};

// 한 지점×용기 상세 — 어느 출고일(계산서)에 몇 개 나갔는지 + 회수 이력.
export async function computeContainerBranchDetail(
  containerId: string,
  userId: string,
): Promise<{ shipments: ContainerShipEntry[]; returns: ContainerReturnEntry[] }> {
  await requireAdmin();
  const c = await prisma.returnableContainer.findUnique({
    where: { id: containerId },
  });
  if (!c) return { shipments: [], returns: [] };
  const key = norm(c.matchKey);
  const invoices = key
    ? await prisma.invoice.findMany({
        where: {
          userId,
          date: { gte: c.startDate },
          status: { in: ["ISSUED", "PAID"] },
          items: { some: { category: "TOOL" } },
        },
        select: {
          date: true,
          items: { where: { category: "TOOL" }, select: { name: true, qty: true } },
        },
      })
    : [];
  // 같은 출고일 여러 장이면 합산.
  const byDate = new Map<string, number>();
  for (const inv of invoices) {
    let add = 0;
    for (const it of inv.items)
      if (norm(it.name).includes(key)) add += Math.round(it.qty || 0);
    if (add > 0) byDate.set(inv.date, (byDate.get(inv.date) ?? 0) + add);
  }
  const shipments = [...byDate.entries()]
    .map(([date, qty]) => ({ date, qty }))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const rets = await prisma.containerReturn.findMany({
    where: { containerId, userId },
    orderBy: { returnedAt: "desc" },
    select: { id: true, qty: true, memo: true, adminName: true, returnedAt: true },
  });
  const returns = rets.map((r) => ({
    id: r.id,
    qty: r.qty,
    memo: r.memo,
    adminName: r.adminName,
    returnedAt: r.returnedAt.toISOString(),
  }));
  return { shipments, returns };
}

// ── 회수 기록/취소 ────────────────────────────────────────────────
export async function recordContainerReturn(
  fd: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const admin = await requireAdmin();
  const containerId = String(fd.get("containerId") ?? "");
  const userId = String(fd.get("userId") ?? "");
  const qty = Math.floor(Number(fd.get("qty")) || 0);
  const memo = String(fd.get("memo") ?? "").trim().slice(0, 200);
  if (!containerId || !userId) return { error: "대상이 올바르지 않아요." };
  if (qty <= 0) return { error: "회수 수량을 입력하세요." };
  const [c, u] = await Promise.all([
    prisma.returnableContainer.findUnique({
      where: { id: containerId },
      select: { id: true, name: true },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, storeName: true },
    }),
  ]);
  if (!c) return { error: "비품을 찾을 수 없어요." };
  if (!u) return { error: "지점을 찾을 수 없어요." };
  await prisma.containerReturn.create({
    data: { containerId, userId, qty, memo, adminId: admin.id, adminName: admin.storeName },
  });
  await writeAudit({
    action: "container.return",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `${u.storeName} — ${c.name} ${qty}개 회수`,
    snapshot: { containerId, userId, qty, memo },
  }).catch(() => {});
  revalidatePath("/admin/containers");
  return { ok: true };
}

export async function deleteContainerReturn(
  id: string,
): Promise<{ ok?: boolean; error?: string }> {
  const admin = await requireAdmin();
  if (!id) return { error: "대상이 없어요." };
  const r = await prisma.containerReturn.findUnique({
    where: { id },
    include: {
      container: { select: { name: true } },
      user: { select: { storeName: true } },
    },
  });
  if (!r) return { error: "이미 취소됐어요." };
  await prisma.containerReturn.delete({ where: { id } });
  await writeAudit({
    action: "container.returnDelete",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `${r.user?.storeName ?? ""} — ${r.container?.name ?? ""} 회수 ${r.qty}개 취소`,
    snapshot: { id },
  }).catch(() => {});
  revalidatePath("/admin/containers");
  return { ok: true };
}

// ── 용기 종류 CRUD ────────────────────────────────────────────────
export async function addContainerType(
  fd: FormData,
): Promise<{ ok?: boolean; error?: string; id?: string }> {
  const admin = await requireAdmin();
  const name = String(fd.get("name") ?? "").trim().slice(0, 60);
  const matchKeyRaw = String(fd.get("matchKey") ?? "").trim();
  const matchKey = (matchKeyRaw || name).slice(0, 60);
  const startDate = normalizeDateStr(String(fd.get("startDate") ?? ""));
  if (!name) return { error: "비품 이름을 입력하세요." };
  if (!norm(matchKey)) return { error: "매칭 키워드가 비어 있어요." };
  const agg = await prisma.returnableContainer.aggregate({
    _max: { sortOrder: true },
  });
  const created = await prisma.returnableContainer.create({
    data: {
      name,
      matchKey,
      startDate,
      sortOrder: (agg._max.sortOrder ?? 0) + 1,
      active: true,
    },
  });
  await writeAudit({
    action: "container.typeAdd",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `비품 종류 추가 — ${name}`,
    snapshot: { name, matchKey, startDate },
  }).catch(() => {});
  revalidatePath("/admin/containers");
  return { ok: true, id: created.id };
}

export async function updateContainerType(
  fd: FormData,
): Promise<{ ok?: boolean; error?: string }> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "대상이 없어요." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 60);
  const matchKeyRaw = String(fd.get("matchKey") ?? "").trim();
  const matchKey = (matchKeyRaw || name).slice(0, 60);
  const startDate = normalizeDateStr(String(fd.get("startDate") ?? ""));
  const active = String(fd.get("active") ?? "true") === "true";
  if (!name) return { error: "비품 이름을 입력하세요." };
  if (!norm(matchKey)) return { error: "매칭 키워드가 비어 있어요." };
  const exists = await prisma.returnableContainer.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { error: "비품을 찾을 수 없어요." };
  await prisma.returnableContainer.update({
    where: { id },
    data: { name, matchKey, startDate, active },
  });
  await writeAudit({
    action: "container.typeUpdate",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `비품 종류 수정 — ${name}`,
    snapshot: { id, name, matchKey, startDate, active },
  }).catch(() => {});
  revalidatePath("/admin/containers");
  return { ok: true };
}
