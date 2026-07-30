"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { WAREHOUSE_UNLOCK_COOKIE } from "@/lib/warehouse-auth";

// PC 창고관리 — 위치별 박스 CRUD + 장소(WarehouseLocation) 관리. 새롭 관리자(ADMIN_SAEROP) 전용 + 비밀번호 게이트.
// 발주/재고 등 기존 데이터는 읽기만(재고 품목 목록) 하고, 쓰기는 WarehouseBox/WarehouseLocation에만 한다.

// 창고관리 진입 비밀번호(관리자 계정으로 로그인 후 한 번 더). 쿠키 wh_unlock=1.
const WAREHOUSE_PASSWORD = "1234";

// 위치는 WarehouseLocation(DB)에 실제 존재하는 id만 허용.
async function locationExists(id: string): Promise<boolean> {
  if (!id) return false;
  const loc = await prisma.warehouseLocation.findUnique({
    where: { id },
    select: { id: true },
  });
  return !!loc;
}

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
  await requireAdmin();
  if (!(await locationExists(location))) return [];
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
  await requireAdmin();
  if (!(await locationExists(input.location)))
    return { ok: false, error: "잘못된 위치" };
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
  color?: string; // 셀 배경색(우클릭 색 선택). ""=기본색으로 초기화. 허용: "" 또는 #rrggbb.
}): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const id = String(input.id ?? "");
  if (!id) return { ok: false, error: "id 없음" };
  const data: Record<string, number | string> = {};
  if (input.x != null) data.x = clampPos(input.x);
  if (input.y != null) data.y = clampPos(input.y);
  if (input.w != null) data.w = clampSize(input.w);
  if (input.h != null) data.h = clampSize(input.h);
  if (input.z != null) data.z = Math.max(0, Math.round(Number(input.z) || 0));
  if (input.color != null) {
    // 안전: 빈 문자열(기본색 초기화) 또는 #rrggbb 6자리 헥스만 저장.
    const c = String(input.color);
    if (c === "" || /^#[0-9a-fA-F]{6}$/.test(c)) data.color = c;
  }
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
  await requireAdmin();
  const boxId = String(id ?? "");
  if (!boxId) return { ok: false };
  await prisma.warehouseBox.deleteMany({ where: { id: boxId } });
  revalidatePath("/warehouse");
  return { ok: true };
}

// ── 창고 장소(WarehouseLocation) 관리 — 추가/이름변경/삭제 ──
export async function addLocationAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!name) return;
  const max = await prisma.warehouseLocation.aggregate({
    _max: { sortOrder: true },
  });
  await prisma.warehouseLocation.create({
    data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  revalidatePath("/warehouse");
}

export async function renameLocationAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "").trim().slice(0, 40);
  if (!id || !name) return;
  await prisma.warehouseLocation.updateMany({ where: { id }, data: { name } });
  revalidatePath("/warehouse");
}

export async function deleteLocationAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  // 안전장치: 박스가 남아있는 장소·마지막 남은 장소는 삭제 불가.
  const [boxCount, locCount] = await Promise.all([
    prisma.warehouseBox.count({ where: { location: id } }),
    prisma.warehouseLocation.count(),
  ]);
  if (boxCount > 0 || locCount <= 1) return;
  await prisma.warehouseLocation.deleteMany({ where: { id } });
  revalidatePath("/warehouse");
}

// 장소 순서 바꾸기(위/아래) — sortOrder를 재정렬해 저장.
export async function moveLocationAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  const dir = String(formData.get("dir") ?? "");
  if (!id || (dir !== "up" && dir !== "down")) return;
  const locs = await prisma.warehouseLocation.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const i = locs.findIndex((l) => l.id === id);
  if (i < 0) return;
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= locs.length) return;
  const order = locs.map((l) => l.id);
  [order[i], order[j]] = [order[j], order[i]];
  await prisma.$transaction(
    order.map((lid, idx) =>
      prisma.warehouseLocation.update({ where: { id: lid }, data: { sortOrder: idx } }),
    ),
  );
  revalidatePath("/warehouse");
}

// 보드 저장(저장 버튼) — 이 장소의 평면도 크기 + 모든 박스 위치/크기를 DB에 확정 저장.
// 평면도 크기가 장소에 저장되므로 다른 컴퓨터에서도 동일하게 보인다.
export async function saveBoardAction(input: {
  location: string;
  w: number;
  h: number;
  boxes: { id: string; x: number; y: number; w: number; h: number }[];
}): Promise<{ ok: boolean }> {
  await requireAdmin();
  const loc = String(input.location ?? "");
  if (!(await locationExists(loc))) return { ok: false };
  const cw = Math.max(600, Math.min(20000, Math.round(Number(input.w) || 1600)));
  const ch = Math.max(400, Math.min(20000, Math.round(Number(input.h) || 1000)));
  const boxes = Array.isArray(input.boxes) ? input.boxes.slice(0, 3000) : [];
  await prisma.$transaction([
    prisma.warehouseLocation.update({ where: { id: loc }, data: { w: cw, h: ch } }),
    ...boxes.map((b) =>
      prisma.warehouseBox.updateMany({
        where: { id: String(b.id), location: loc },
        data: { x: clampPos(b.x), y: clampPos(b.y), w: clampSize(b.w), h: clampSize(b.h) },
      }),
    ),
  ]);
  revalidatePath("/warehouse");
  return { ok: true };
}

// ── 창고관리 진입 비밀번호 확인 → 통과 시 쿠키 세팅 ──
export async function unlockWarehouseAction(formData: FormData) {
  await requireAdmin();
  const pw = String(formData.get("password") ?? "");
  if (pw !== WAREHOUSE_PASSWORD) redirect("/warehouse?pw=bad");
  const jar = await cookies();
  jar.set(WAREHOUSE_UNLOCK_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // 만료 없음 = 세션 쿠키(브라우저 닫으면 해제). 근무 중엔 한 번만 입력.
  });
  redirect("/warehouse");
}
