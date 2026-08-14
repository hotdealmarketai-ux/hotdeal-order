"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { normalizeTax } from "@/lib/tax";

export type ChaeumchaeProductState = { ok?: boolean; error?: string };

type ProductRow = {
  id?: string | null;
  seq?: string;
  name?: string;
  hasBox?: boolean;
  perBox?: string | number;
  piecePrice?: string | number;
  unit?: string;
  tax?: string;
  deleted?: boolean;
};

// 소수·부호를 조용히 왜곡하지 않게 — 점을 지우지 말고(그러면 '1.5'→'15') 반올림한다. 잘못된 형식은 0→min으로 클램프.
const toInt = (v: unknown, min: number) =>
  Math.max(min, Math.round(Number(String(v ?? "").replace(/[^0-9.]/g, "")) || 0));

// 채움채 상품 저장 — 추가/수정/삭제(소프트, active=false)를 한 번에. 박스입수·낱개단가·과세면세·단위 관리.
export async function saveChaeumchaeProductsAction(
  _prev: ChaeumchaeProductState,
  formData: FormData,
): Promise<ChaeumchaeProductState> {
  await requireAdmin();
  let rows: ProductRow[] = [];
  try {
    rows = JSON.parse(String(formData.get("payload") ?? "[]"));
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows)) rows = [];

  const maxAgg = await prisma.chaeumchaeProduct.aggregate({ _max: { sortOrder: true } });
  let nextSort = (maxAgg._max.sortOrder ?? 0) + 1;

  const ops = [];
  for (const r of rows) {
    const id = r.id ? String(r.id) : null;
    if (r.deleted) {
      if (id) {
        ops.push(
          prisma.chaeumchaeProduct.updateMany({ where: { id }, data: { active: false } }),
        );
      }
      continue;
    }
    const name = String(r.name ?? "").trim().slice(0, 100);
    if (!name) continue; // 이름 없는 빈 추가행은 무시
    const hasBox = r.hasBox !== false; // 기본 true(박스)
    const perBox = hasBox ? Math.max(1, toInt(r.perBox, 1)) : 1; // 낱개단위면 배수 1
    const piecePrice = toInt(r.piecePrice, 0);
    const unit = String(r.unit ?? "").trim().slice(0, 8) || "개";
    const tax = normalizeTax(r.tax);
    const seq = String(r.seq ?? "").trim().slice(0, 20);
    const data = { name, hasBox, perBox, piecePrice, unit, tax, seq, active: true };
    if (id) {
      ops.push(prisma.chaeumchaeProduct.updateMany({ where: { id }, data }));
    } else {
      ops.push(
        prisma.chaeumchaeProduct.create({ data: { ...data, sortOrder: nextSort++ } }),
      );
    }
  }
  if (ops.length > 0) await prisma.$transaction(ops);
  revalidatePath("/inventory-pc");
  return { ok: true };
}
