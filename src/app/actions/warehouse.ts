"use server";

import { prisma } from "@/lib/prisma";
import { requireWarehouse } from "@/lib/session";
import { revalidatePath } from "next/cache";

// PC 창고관리 — 위치별 박스 CRUD. WAREHOUSE 계정 전용.
// 발주/재고 등 기존 데이터는 읽기만(재고 품목 목록) 하고, 쓰기는 WarehouseBox에만 한다.

// "use server" 파일은 async 함수만 export 가능 — 상수/타입은 내부(모듈 지역)로 둔다.
const WAREHOUSE_LOCATIONS = ["FLOOR1", "FREEZER", "FRIDGE"] as const;
type WarehouseLocation = (typeof WAREHOUSE_LOCATIONS)[number];

const isLoc = (v: unknown): v is WarehouseLocation =>
  typeof v === "string" && (WAREHOUSE_LOCATIONS as readonly string[]).includes(v);

// 좌표/크기 방어(음수·과대값 차단). 캔버스 논리좌표(px) 기준.
const clampPos = (n: unknown) =>
  Math.max(0, Math.min(20000, Math.round(Number(n) || 0)));
const clampSize = (n: unknown) =>
  Math.max(24, Math.min(4000, Math.round(Number(n) || 24)));

export type BoxDTO = {
  id: string;
  location: string;
  itemId: string | null;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  z: number;
};

export async function listBoxes(location: string): Promise<BoxDTO[]> {
  await requireWarehouse();
  if (!isLoc(location)) return [];
  const rows = await prisma.warehouseBox.findMany({
    where: { location },
    orderBy: { z: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    location: r.location,
    itemId: r.itemId,
    label: r.label,
    x: r.x,
    y: r.y,
    w: r.w,
    h: r.h,
    color: r.color,
    z: r.z,
  }));
}

export async function createBox(input: {
  location: string;
  itemId?: string | null;
  label: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  color?: string; // #12 "form" = 폼박스(창문/문/계단 등 구조물)
}): Promise<{ ok: boolean; box?: BoxDTO; error?: string }> {
  await requireWarehouse();
  if (!isLoc(input.location)) return { ok: false, error: "잘못된 위치" };
  const label = String(input.label ?? "").trim().slice(0, 80);
  if (!label) return { ok: false, error: "이름이 필요해요." };
  const color = input.color === "form" ? "form" : "";
  // 폼박스(구조물)는 맨 뒤(z=0), 재고박스는 맨 위(최대 z + 1).
  const top = await prisma.warehouseBox.findFirst({
    where: { location: input.location },
    orderBy: { z: "desc" },
    select: { z: true },
  });
  const r = await prisma.warehouseBox.create({
    data: {
      location: input.location,
      itemId: input.itemId ? String(input.itemId) : null,
      label,
      x: clampPos(input.x ?? 40),
      y: clampPos(input.y ?? 40),
      w: clampSize(input.w ?? 140),
      h: clampSize(input.h ?? 90),
      color,
      z: color === "form" ? 0 : (top?.z ?? 0) + 1,
    },
  });
  revalidatePath("/warehouse");
  return {
    ok: true,
    box: {
      id: r.id,
      location: r.location,
      itemId: r.itemId,
      label: r.label,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      color: r.color,
      z: r.z,
    },
  };
}

// 위치/크기 저장(드래그·리사이즈 후). 부분 업데이트 허용.
export async function updateBox(input: {
  id: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  label?: string;
  z?: number;
}): Promise<{ ok: boolean; error?: string }> {
  await requireWarehouse();
  const id = String(input.id ?? "");
  if (!id) return { ok: false, error: "id 없음" };
  const data: Record<string, number | string> = {};
  if (input.x != null) data.x = clampPos(input.x);
  if (input.y != null) data.y = clampPos(input.y);
  if (input.w != null) data.w = clampSize(input.w);
  if (input.h != null) data.h = clampSize(input.h);
  if (input.z != null) data.z = Math.max(0, Math.round(Number(input.z) || 0));
  if (input.label != null) {
    const l = String(input.label).trim().slice(0, 80);
    if (l) data.label = l;
  }
  if (Object.keys(data).length === 0) return { ok: true };
  try {
    await prisma.warehouseBox.update({ where: { id }, data });
    return { ok: true };
  } catch {
    return { ok: false, error: "저장 실패" };
  }
}

export async function deleteBox(id: string): Promise<{ ok: boolean }> {
  await requireWarehouse();
  const boxId = String(id ?? "");
  if (!boxId) return { ok: false };
  await prisma.warehouseBox.deleteMany({ where: { id: boxId } });
  revalidatePath("/warehouse");
  return { ok: true };
}
