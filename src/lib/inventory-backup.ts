import { prisma } from "@/lib/prisma";

// 재고현황(InventoryItem) 스냅샷 백업/복구 — AppMeta 에 JSON 으로 저장(별도 테이블/마이그레이션 없이).
// 목적: 자동저장 전량삭제·붙여넣기 등으로 재고가 통째로 날아가도 되돌릴 수 있게(감사 #2/H2).
// 키: `invsnap:<ISO시각>` → 사전순=시간순. 최근 KEEP 개만 남기고 오래된 건 정리.

const PREFIX = "invsnap:";
const KEEP = 20;

type SnapItem = {
  id: string;
  name: string;
  status: string;
  qty: number;
  supplyPrice: number;
  expiry: string;
  majorCat: string;
  minorCat: string;
  memo: string;
  sortOrder: number;
};

export type SnapshotMeta = {
  key: string;
  label: string;
  count: number;
  createdAt: string; // ISO
};

// 현재 재고 전체를 스냅샷으로 저장. 오래된 건 최근 KEEP 개만 남긴다.
export async function snapshotInventory(
  label: string,
): Promise<{ ok: boolean; count: number }> {
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: {
      id: true, name: true, status: true, qty: true, supplyPrice: true,
      expiry: true, majorCat: true, minorCat: true, memo: true, sortOrder: true,
    },
  });
  const snap: SnapItem[] = items.map((i) => ({
    id: i.id,
    name: i.name,
    status: i.status ?? "",
    qty: i.qty ?? 0,
    supplyPrice: i.supplyPrice ?? 0,
    expiry: i.expiry ?? "",
    majorCat: i.majorCat ?? "",
    minorCat: i.minorCat ?? "",
    memo: i.memo ?? "",
    sortOrder: i.sortOrder ?? 0,
  }));
  const key = `${PREFIX}${new Date().toISOString()}`;
  await prisma.appMeta.create({
    data: { key, value: JSON.stringify({ label, count: snap.length, items: snap }) },
  });
  // 정리 — 최근 KEEP 개만 유지
  const all = await prisma.appMeta.findMany({
    where: { key: { startsWith: PREFIX } },
    orderBy: { key: "desc" },
    select: { key: true },
  });
  const stale = all.slice(KEEP).map((a) => a.key);
  if (stale.length) await prisma.appMeta.deleteMany({ where: { key: { in: stale } } });
  return { ok: true, count: snap.length };
}

// 저장된 백업 목록(최신순).
export async function listInventorySnapshots(): Promise<SnapshotMeta[]> {
  const rows = await prisma.appMeta.findMany({
    where: { key: { startsWith: PREFIX } },
    orderBy: { key: "desc" },
    select: { key: true, value: true },
  });
  return rows.map((r) => {
    let label = "";
    let count = 0;
    try {
      const j = JSON.parse(r.value || "{}");
      label = typeof j.label === "string" ? j.label : "";
      count = typeof j.count === "number" ? j.count : Array.isArray(j.items) ? j.items.length : 0;
    } catch {
      /* 손상된 값은 라벨/카운트 없이 표시 */
    }
    return { key: r.key, label, count, createdAt: r.key.slice(PREFIX.length) };
  });
}

// 복구 — 스냅샷의 각 품목을 id 기준 upsert(삭제됐던 품목도 되살림). 현재 있는 다른 품목은 지우지 않음(가산 복구).
export async function restoreInventorySnapshot(
  key: string,
): Promise<{ ok: boolean; restored: number; error?: string }> {
  if (!key.startsWith(PREFIX)) return { ok: false, restored: 0, error: "잘못된 백업입니다." };
  const row = await prisma.appMeta.findUnique({ where: { key } });
  if (!row) return { ok: false, restored: 0, error: "백업을 찾을 수 없어요." };
  let items: SnapItem[] = [];
  try {
    const j = JSON.parse(row.value || "{}");
    items = Array.isArray(j.items) ? j.items : [];
  } catch {
    return { ok: false, restored: 0, error: "백업을 읽지 못했어요." };
  }
  let restored = 0;
  for (const it of items) {
    const id = String(it?.id ?? "");
    const name = String(it?.name ?? "").trim();
    if (!id || !name) continue;
    const data = {
      name,
      status: String(it.status ?? ""),
      qty: Number(it.qty) || 0,
      supplyPrice: Number(it.supplyPrice) || 0,
      expiry: String(it.expiry ?? ""),
      majorCat: String(it.majorCat ?? ""),
      minorCat: String(it.minorCat ?? ""),
      memo: String(it.memo ?? ""),
      sortOrder: Number(it.sortOrder) || 0,
      deletedAt: null,
    };
    await prisma.inventoryItem.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    restored++;
  }
  return { ok: true, restored };
}
