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

// 값이 바뀔 때마다 '한 건씩' 영구 기록한다. 원래 값으로 되돌리는 것도 하나의 변경이므로 그대로 남긴다
// (되돌렸다고 지우지 않음 — 사장 요청). 자동저장 디바운스(0.8s)라 연속 타이핑은 대개 순변화 1건으로 저장된다.
export async function recordInventoryChanges(
  changes: InvChange[],
  actor: { id: string; name: string },
  source: string,
): Promise<void> {
  for (const c of changes) {
    if (!c.itemId || !c.field) continue;
    try {
      await prisma.inventoryChangeLog.create({
        data: {
          itemId: c.itemId,
          itemName: c.itemName,
          field: c.field,
          kind: c.kind ?? "update",
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
