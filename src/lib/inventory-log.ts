// 재고현황 품목 값 변경 기록(감사). 수기 편집으로 값이 바뀔 때마다 필드별 before→after 를 남긴다.
// 로그 실패가 재고 편집을 막으면 안 되므로 모두 best-effort(try/catch).
import { prisma } from "@/lib/prisma";

// 필드 → 한글 라벨(기록 페이지 표시용)
export const INV_FIELD_LABEL: Record<string, string> = {
  name: "품목명",
  qty: "수량",
  supplyPrice: "공급가",
  expiry: "유통기한",
  majorCat: "대분류",
  minorCat: "중분류",
  tax: "과세/면세",
  memo: "메모",
  "(추가)": "품목 추가",
  "(삭제)": "품목 삭제",
};

export const TAX_LABEL: Record<string, string> = {
  TAXABLE: "과세",
  EXEMPT: "면세",
  "": "미선택",
};

const S = (v: unknown) => (v == null ? "" : String(v));

export type InvChange = {
  itemId: string;
  itemName: string;
  field: string;
  before: string;
  after: string;
  kind?: "create" | "update" | "delete";
};

// before/after 객체에서 지정 필드들의 실제 변경분만 뽑는다.
export function diffInventoryFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[],
): { field: string; before: string; after: string }[] {
  const out: { field: string; before: string; after: string }[] = [];
  for (const f of fields) {
    const b = S(before[f]);
    const a = S(after[f]);
    if (b !== a) out.push({ field: f, before: b, after: a });
  }
  return out;
}

// 같은 (품목·필드·작성자) 를 5분 내 연속 수정하면 마지막 로그의 after 만 갱신(타이핑 중간값 누적 방지).
// 최종값이 원래 before 로 되돌아오면 그 로그를 삭제(순변화 없음).
const COALESCE_MS = 5 * 60 * 1000;

export async function recordInventoryChanges(
  changes: InvChange[],
  actor: { id: string; name: string },
  source: string,
): Promise<void> {
  const now = Date.now();
  for (const c of changes) {
    if (!c.itemId || !c.field) continue;
    try {
      const kind = c.kind ?? "update";
      if (kind === "update") {
        const prev = await prisma.inventoryChangeLog.findFirst({
          where: {
            itemId: c.itemId,
            field: c.field,
            kind: "update",
            actorId: actor.id,
            source, // 같은 진입점(경로)끼리만 병합 — 경로 라벨이 뒤섞이지 않게
            createdAt: { gte: new Date(now - COALESCE_MS) },
          },
          orderBy: { createdAt: "desc" },
        });
        if (prev) {
          if (prev.before === c.after) {
            // 원래 값으로 되돌림 → 순변화 없음, 로그 제거
            await prisma.inventoryChangeLog.delete({ where: { id: prev.id } });
          } else {
            await prisma.inventoryChangeLog.update({
              where: { id: prev.id },
              data: { after: c.after, itemName: c.itemName, createdAt: new Date() },
            });
          }
          continue;
        }
      }
      await prisma.inventoryChangeLog.create({
        data: {
          itemId: c.itemId,
          itemName: c.itemName,
          field: c.field,
          kind,
          before: c.before,
          after: c.after,
          actorId: actor.id,
          actorName: actor.name,
          source,
        },
      });
    } catch {
      /* 로그 실패는 무시 — 재고 편집을 막지 않는다 */
    }
  }
}
