"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { writeAudit } from "@/lib/audit";
import {
  setOrderFlag,
  ORDER_FLAG_KEYS,
  type OrderFlagKey,
} from "@/lib/order-flags";

type Res = { ok?: boolean; error?: string };

function revalidateAll() {
  revalidatePath("/admin/order-config");
  revalidatePath("/order");
}

const FLAG_LABEL: Record<OrderFlagKey, string> = {
  gridOff: "칸 발주 잠금",
  chatOff: "채팅 발주 잠금",
  fixedFruit: "과일 품목 고정",
  fixedVeg: "야채 품목 고정",
};

/** 발주 방식/품목 고정 스위치 토글. */
export async function setOrderModeFlagAction(fd: FormData): Promise<Res> {
  const admin = await requireAdmin();
  const key = String(fd.get("key") ?? "") as OrderFlagKey;
  if (!ORDER_FLAG_KEYS.includes(key)) return { error: "잘못된 요청이에요." };
  const on = String(fd.get("on") ?? "") === "true";
  await setOrderFlag(key, on);
  await writeAudit({
    action: "orderConfig.flag",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `${FLAG_LABEL[key]} ${on ? "ON" : "OFF"}`,
  }).catch(() => {});
  revalidateAll();
  return { ok: true };
}

function normCategory(v: unknown): "FRUIT" | "VEG" | null {
  const s = String(v ?? "");
  return s === "FRUIT" || s === "VEG" ? s : null;
}

/** 고정 품목 추가(카테고리 맨 끝 순서). */
export async function addFixedItemAction(fd: FormData): Promise<Res> {
  const admin = await requireAdmin();
  const category = normCategory(fd.get("category"));
  if (!category) return { error: "잘못된 분류예요." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 60);
  if (!name) return { error: "품목명을 입력하세요." };

  const last = await prisma.fixedOrderItem.findFirst({
    where: { category },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  await prisma.fixedOrderItem.create({
    data: { category, name, sortOrder: (last?.sortOrder ?? 0) + 1, active: true },
  });
  await writeAudit({
    action: "orderConfig.itemAdd",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `고정 품목 추가 — ${category === "FRUIT" ? "과일" : "야채"} · ${name}`,
  }).catch(() => {});
  revalidateAll();
  return { ok: true };
}

/** 고정 품목 이름 수정. */
export async function updateFixedItemAction(fd: FormData): Promise<Res> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const name = String(fd.get("name") ?? "").trim().slice(0, 60);
  if (!id) return { error: "잘못된 요청이에요." };
  if (!name) return { error: "품목명을 입력하세요." };
  const cur = await prisma.fixedOrderItem.findUnique({ where: { id } });
  if (!cur) return { error: "이미 삭제된 품목이에요." };
  if (cur.name === name) return { ok: true };
  await prisma.fixedOrderItem.update({ where: { id }, data: { name } });
  await writeAudit({
    action: "orderConfig.itemEdit",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `고정 품목 수정 — ${cur.name} → ${name}`,
  }).catch(() => {});
  revalidateAll();
  return { ok: true };
}

/** 고정 품목 노출/미노출 토글. */
export async function toggleFixedItemAction(fd: FormData): Promise<Res> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const active = String(fd.get("active") ?? "") === "true";
  if (!id) return { error: "잘못된 요청이에요." };
  const cur = await prisma.fixedOrderItem.findUnique({ where: { id } });
  if (!cur) return { error: "이미 삭제된 품목이에요." };
  await prisma.fixedOrderItem.update({ where: { id }, data: { active } });
  await writeAudit({
    action: "orderConfig.itemToggle",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `고정 품목 ${active ? "노출" : "미노출"} — ${cur.name}`,
  }).catch(() => {});
  revalidateAll();
  return { ok: true };
}

/** 고정 품목 삭제. */
export async function deleteFixedItemAction(fd: FormData): Promise<Res> {
  const admin = await requireAdmin();
  const id = String(fd.get("id") ?? "");
  if (!id) return { error: "잘못된 요청이에요." };
  const cur = await prisma.fixedOrderItem.findUnique({ where: { id } });
  if (!cur) return { ok: true };
  await prisma.fixedOrderItem.delete({ where: { id } });
  await writeAudit({
    action: "orderConfig.itemDelete",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `고정 품목 삭제 — ${cur.category === "FRUIT" ? "과일" : "야채"} · ${cur.name}`,
  }).catch(() => {});
  revalidateAll();
  return { ok: true };
}

/** 고정 품목 순서 이동(위/아래) — 같은 카테고리 이웃과 sortOrder 교환. */
export async function moveFixedItemAction(fd: FormData): Promise<Res> {
  await requireAdmin();
  const id = String(fd.get("id") ?? "");
  const dir = String(fd.get("dir") ?? "");
  if (!id || (dir !== "up" && dir !== "down")) return { error: "잘못된 요청이에요." };
  const cur = await prisma.fixedOrderItem.findUnique({ where: { id } });
  if (!cur) return { error: "이미 삭제된 품목이에요." };

  // 같은 카테고리 전체를 순서대로 읽어 배열 위치를 옮긴 뒤 sortOrder를 0..n 으로 재부여한다.
  // (값 교환 방식은 인접 두 항목의 sortOrder가 같으면 no-op이 되므로 위치 기반 재부여로 확정 이동.)
  const list = await prisma.fixedOrderItem.findMany({
    where: { category: cur.category },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  const idx = list.findIndex((r) => r.id === id);
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (idx < 0 || swapIdx < 0 || swapIdx >= list.length) return { ok: true }; // 끝이면 무시
  const arr = [...list];
  const [moving] = arr.splice(idx, 1);
  arr.splice(swapIdx, 0, moving);
  await prisma.$transaction(
    arr.map((r, i) =>
      prisma.fixedOrderItem.update({ where: { id: r.id }, data: { sortOrder: i } }),
    ),
  );
  revalidateAll();
  return { ok: true };
}
