"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireAdmin, getCurrentUser } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { getOrCreateFlatBatchId, kstTodayStr } from "@/lib/reservation-flat";
import { minLockedPickupDate } from "@/lib/reservation-stock";
import { windowKeyAt } from "@/lib/schedule";
import { dowOf, normalizeDateStr } from "@/lib/date";
import { logError } from "@/lib/log";
import { notifyFlatShipmentMoved } from "@/lib/push-flat";
import { reservationWriteBlock } from "@/lib/merchant-gate";
import {
  FLAT_DESC_MAX,
  flatQtyProblem,
  parseMinInput,
  type FlatQtyRule,
} from "@/lib/flat-qty-rule";

type ResvHoldResult = { ok: boolean; error?: string; available?: number };

async function requireHotdealMerchant() {
  const user = await getCurrentUser();
  if (!user || user.status !== "APPROVED" || user.role !== "MERCHANT_HOTDEAL") {
    return { user: null, error: "권한이 없어요." } as const;
  }
  // 지점별 공산품 노출 off 등 쓰기 관문(merchant-gate)에 걸리면 현행(flat) 액션(발주·해제·담기)도 전부 차단 —
  // UI는 라우트 게이트로 가려지지만 서버액션은 POST 엔드포인트라 직접 호출 방어가 필요하다(회원관리 토글).
  // 판정은 merchant-gate 하나만 본다. 품목 제한 모드는 막지 않는다(공구는 공산품으로만 받음).
  const block = await reservationWriteBlock(user);
  if (block) return { user: null, error: block.message } as const;
  return { user, error: null } as const;
}

const CLOSED_MSG = "발주가 마감됐어요.";
const SUNDAY_MSG = "일요일은 출고가 없어요. 다른 날을 골라 주세요.";
const PRICE_MAX = 100_000_000; // 공급가 상한(오타 방지)

/**
 * 0 이상 정수 칸 해석 — 빈칸은 empty, 숫자가 아니거나 범위를 벗어나면 오류 문구(말없이 0으로 바꾸지 않는다).
 * 금액 칸이 콤마·공백을 섞어 보내도 받는다.
 */
function intField(
  v: unknown,
  o: { empty: number; min?: number; max: number; bad: string; big: string },
): number | { error: string } {
  const t = typeof v === "number" ? String(v) : String(v ?? "").replace(/[,\s]/g, "");
  if (t === "") return o.empty;
  if (!/^\d+$/.test(t)) return { error: o.bad };
  const n = Number(t);
  if (o.min !== undefined && n < o.min) return { error: o.bad };
  if (n > o.max) return { error: o.big };
  return n;
}

// datetime-local(브라우저=KST 가정) "YYYY-MM-DDTHH:MM[:SS]" → UTC Date(+09:00).
function parseCloseAtKst(local: string): Date | null {
  const s = String(local ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(s)) return null;
  const withSec = s.length === 16 ? `${s}:00` : s;
  const d = new Date(`${withSec}+09:00`);
  return isNaN(d.getTime()) ? null : d;
}
// UTC Date → KST YYYY-MM-DD
function kstDateOf(d: Date): string {
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 출고·계산서로 나가는 줄인가 — 출고·계산서(reservation-data.ts)와 같은 조건(품목 확정 OR 옛 주문 확정). */
const CONFIRMED_ROW: Prisma.ReservationOrderItemWhereInput = {
  OR: [{ confirmedAt: { not: null } }, { order: { confirmed: true } }],
};

/** 지점 이름 목록을 짧게 — "강남점, 홍대점 외 3곳" */
function storeList(names: string[]): string {
  const uniq = [...new Set(names)].sort((a, b) => a.localeCompare(b, "ko"));
  return uniq.length <= 3 ? uniq.join(", ") : `${uniq.slice(0, 3).join(", ")} 외 ${uniq.length - 3}곳`;
}

/**
 * 확정 줄이 실린 그 줄 출고일 계산서(작성 중 포함, 취소 제외)가 있는 지점 이름 — 없으면 "".
 * 계산서 자동 채움·불러오기·발행 차감이 모두 '이름'으로 맞추므로 같은 이름 공구 줄이 든 계산서만 센다
 * (세트는 계산서에 구성품 이름으로 풀려 들어가므로 extraNames 로 구성품 이름도 함께).
 */
async function billedStores(
  tx: Prisma.TransactionClient,
  rows: { name: string; pickupDate: string; order: { userId: string } }[],
  extraNames: string[],
): Promise<string> {
  if (rows.length === 0) return "";
  const names = new Set<string>();
  for (const r of rows) names.add(r.name).add(r.name.trim());
  for (const n of extraNames) names.add(n).add(n.trim());
  const billed = await tx.invoice.findMany({
    where: {
      status: { not: "VOID" },
      OR: rows.map((r) => ({ userId: r.order.userId, date: r.pickupDate })),
      items: { some: { category: { in: ["TOOL", "SADADREAM"] }, name: { in: [...names] } } },
    },
    select: { user: { select: { storeName: true } } },
  });
  return billed.length > 0 ? storeList(billed.map((b) => b.user.storeName)) : "";
}

// warning: 저장은 됐지만 관리자가 알아야 할 것(같은 출고일·같은 이름, 규칙과 다른 지점 등). id: 새로 등록한 상품 id.
export type FlatProductState = { ok?: boolean; error?: string; warning?: string; id?: string };

// 관리자가 그 사이 상품의 연동·종류(세트/단일)를 바꿨을 때 — 옛 정보로 예약 줄을 쓰지 않고 다시 보게 한다.
const PRODUCT_CHANGED = "상품 정보가 바뀌었어요. 새로고침해 주세요.";

/**
 * 예약 줄을 쓰기 전에 상품 행을 함께 잠그고(FOR SHARE — 관리자 저장의 FOR UPDATE 와 줄 세움) 지금 값을 다시 읽는다.
 * 트랜잭션 밖에서 읽은 값과 다르면(관리자가 그 사이 저장) 옛 값으로 예약 줄을 쓰지 않게 호출부가 거절한다.
 */
async function lockProductLink(tx: Prisma.TransactionClient, productId: string) {
  await tx.$executeRaw`SELECT id FROM "ReservationProduct" WHERE id = ${productId} FOR SHARE`;
  return tx.reservationProduct.findUnique({
    where: { id: productId },
    select: {
      inventoryItemId: true,
      name: true,
      supplyPrice: true,
      pickupDate: true,
      closeAt: true,
      stockFixed: true,
      minPerStore: true,
      description: true,
      active: true,
      components: { where: { inventoryItemId: { not: "" } }, select: { inventoryItemId: true, qtyPerUnit: true } },
      _count: { select: { components: true } },
    },
  });
}

/**
 * 내 예약 줄(주문×상품 1행)을 잠근다 — 담기(holdFlat·holdSet)와 확정만 찍는 confirmFlat 이 같은 줄을 동시에 쓸 때
 * 줄을 세워, 수량 규칙을 검사한 수량과 확정되는 수량이 같게 한다(잠근 뒤 읽어야 최신 수량·확정 여부를 본다).
 * 잠금 순서는 언제나 상품 행 → (재고 행) → 이 줄. 줄이 아직 없으면 아무것도 잠그지 않는다.
 */
async function lockMyItem(tx: Prisma.TransactionClient, orderId: string, productId: string) {
  await tx.$executeRaw`
    SELECT id FROM "ReservationOrderItem" WHERE "orderId" = ${orderId} AND "productId" = ${productId} FOR UPDATE`;
}

type SnapshotA = {
  name: string;
  supplyPrice: number;
  pickupDate: string;
  closeAt?: Date | null;
  stockFixed?: boolean;
  minPerStore?: number | null;
  description?: string;
};
type SnapshotB = {
  name: string;
  supplyPrice: number;
  pickupDate: string;
  closeAt: Date | null;
  stockFixed: boolean;
  minPerStore: number | null;
  description: string;
  active: boolean;
};

/**
 * 예약 줄에 스냅샷으로 들어가는 상품 값(이름·공급가·출고일)과 판정에 쓰는 값(마감·재고 고정·수량 규칙·안내)이 그대로인가.
 * a 쪽에서 빠진 칸(undefined)은 비교하지 않는다.
 */
function sameSnapshot(a: SnapshotA, b: SnapshotB): boolean {
  return (
    b.active &&
    a.name === b.name &&
    a.supplyPrice === b.supplyPrice &&
    a.pickupDate === b.pickupDate &&
    (a.closeAt === undefined || (a.closeAt?.getTime() ?? null) === (b.closeAt?.getTime() ?? null)) &&
    (a.stockFixed === undefined || a.stockFixed === b.stockFixed) &&
    (a.minPerStore === undefined || a.minPerStore === b.minPerStore) &&
    (a.description === undefined || a.description === b.description)
  );
}

// 관리자: 공산품 삭제(숨김). 확정 주문이 남아 있으면 막는다 — 출고·계산서·본사 출고는 상품 숨김을 보지 않아
//  지워도 확정분이 그대로 나가기 때문(관리자가 '지웠으니 안 나간다'고 오해하지 않게). 0으로 고친 뒤 지우게 안내.
async function deleteFlatProduct(admin: { id: string; storeName: string }, id: string): Promise<FlatProductState> {
  if (!id) return { error: "잘못된 요청이에요." };
  const today = kstTodayStr();
  const out = await prisma.$transaction(async (tx): Promise<FlatProductState & { name?: string }> => {
    // 점주 발주·관리자 대신 고치기는 같은 행을 FOR SHARE 로 잠그므로, 확인~숨김 사이에 새 확정이 끼지 않는다.
    await tx.$executeRaw`SELECT id FROM "ReservationProduct" WHERE id = ${id} FOR UPDATE`;
    const p = await tx.reservationProduct.findFirst({
      where: { id, closeAt: { not: null } },
      select: { name: true },
    });
    if (!p) return { error: "상품을 찾을 수 없어요." };
    // 출고일이 지났거나 이미 차감(계산서 발행)된 줄은 고칠 수도 없고 지워도 달라지는 게 없으니 세지 않는다.
    //  어느 지점인지 이름도 알려 준다(정지된 지점도 상품 상세 목록에 떠서 0으로 고칠 수 있다).
    const booked = await tx.reservationOrderItem.findMany({
      where: { productId: id, qty: { gt: 0 }, stockDeductedAt: null, pickupDate: { gte: today }, ...CONFIRMED_ROW },
      select: { order: { select: { userId: true, user: { select: { storeName: true } } } } },
    });
    const stores = new Set(booked.map((b) => b.order.userId)).size;
    if (stores > 0) {
      const names = storeList(booked.map((b) => b.order.user.storeName));
      return { error: `발주한 지점이 있어 삭제할 수 없어요 (${names}). 지점 수량을 0으로 바꾼 뒤 삭제해 주세요.` };
    }
    await tx.reservationProduct.update({ where: { id }, data: { active: false } });
    // 아직 발주 전(미확정)인 줄은 함께 지운다 — 숨긴 상품은 더 발주할 수 없고, 연동 상품이면 재고만 잡고 있게 된다.
    await tx.reservationOrderItem.deleteMany({
      where: { productId: id, confirmedAt: null, stockDeductedAt: null, order: { confirmed: false } },
    });
    return { ok: true, name: p.name };
  });
  if (out.error) return { error: out.error };
  await writeAudit({
    action: "reservation.flatDelete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationProduct",
    targetId: id,
    summary: `공산품 ${out.name ?? ""} 삭제(숨김)`,
  }).catch(() => {});
  revalidatePath("/admin/reservations");
  revalidatePath("/admin/reservations/closed");
  revalidatePath("/admin/reservations/pickup-closed");
  revalidatePath("/reservations");
  revalidatePath("/inventory");
  return { ok: true };
}

// 관리자: 공산품 등록/수정/삭제. 상품별 마감(closeAt, 시분) + 출고일(pickupDate = 계산서 날짜) + 수량 규칙·안내.
//  FormData: id(수정), deleted("true"=삭제), name, closeAt("YYYY-MM-DDTHH:MM", KST), pickupDate, supplyPrice,
//   inventoryItemId, stockFixed("true" — 재고 연동 상품만, 아니면 늘 false), components(JSON, 보내면 구성품 전량 교체),
//   minPerStore(최소 수량 MOQ, 빈칸·0·1=없음), description(한 줄 FLAT_DESC_MAX자).
//  수정 때 minPerStore·description 칸을 아예 안 보내면 그 값은 그대로 둔다(옛 폼 호환).
//  (2026-10-17 발주 단위(qtyStep)·등록 알림(notify)은 없앴다 — 상품 등록은 점주에게 알림을 보내지 않는다.)
export async function saveFlatProductAction(
  _prev: FlatProductState,
  formData: FormData,
): Promise<FlatProductState> {
  const admin = await requireAdmin();
  const id = String(formData.get("id") ?? "").trim();
  if (formData.get("deleted") === "true") return deleteFlatProduct(admin, id);

  const name = String(formData.get("name") ?? "").trim().slice(0, 100);
  const closeAt = parseCloseAtKst(String(formData.get("closeAt") ?? ""));
  const pickupDate = String(formData.get("pickupDate") ?? "").trim();
  // 세트 구성품(선택) — UI가 JSON으로 보냄. 1개 이상이면 '세트', 비어있으면 기존 단일 상품.
  //  구성품: { name, inventoryItemId(""=수기), qtyPerUnit(세트당 수량), supplyPrice(연동이면 재고가 자동기본, 수정값 우선) }
  let rawComps: unknown = [];
  try {
    rawComps = JSON.parse(String(formData.get("components") ?? "[]"));
  } catch {
    return { error: "세트 구성품을 읽지 못했어요. 새로고침해 주세요." };
  }
  const components: { name: string; inventoryItemId: string; qtyPerUnit: number; supplyPrice: number }[] = [];
  for (const c of Array.isArray(rawComps) ? rawComps : []) {
    const cname = String(c?.name ?? "").trim().slice(0, 100);
    if (!cname) continue;
    const per = intField(c?.qtyPerUnit, {
      empty: 1,
      min: 1,
      max: 9999,
      bad: `'${cname}' 세트당 수량은 1 이상으로 넣어 주세요.`,
      big: `'${cname}' 세트당 수량이 너무 커요.`,
    });
    if (typeof per !== "number") return per;
    const price = intField(c?.supplyPrice, {
      empty: 0,
      max: PRICE_MAX,
      bad: `'${cname}' 공급가는 숫자로 넣어 주세요.`,
      big: `'${cname}' 공급가가 너무 커요.`,
    });
    if (typeof price !== "number") return price;
    components.push({
      name: cname,
      inventoryItemId: String(c?.inventoryItemId ?? "").trim(),
      qtyPerUnit: per,
      supplyPrice: price,
    });
  }
  const isSet = components.length > 0;
  // 폼이 구성품을 '관리'하는가 — `components` 필드가 아예 없으면(옛 폼) 기존 구성품을 건드리지 않는다.
  //  (필드가 "[]"로 오면 '구성품 없음(단일)'으로 명시한 것 → 전량 삭제가 맞다.)
  const componentsProvided = formData.get("components") !== null;

  // 단일 상품 입력값(세트면 무시 — 연동은 구성품이 각자, 가격은 구성품 합).
  let singlePrice = 0;
  if (!isSet) {
    const p = intField(formData.get("supplyPrice"), {
      empty: 0,
      max: PRICE_MAX,
      bad: "공급가는 숫자로 넣어 주세요.",
      big: "공급가가 너무 커요.",
    });
    if (typeof p !== "number") return p;
    singlePrice = p;
  }
  const singleInv = String(formData.get("inventoryItemId") ?? "").trim();
  // 세트 공급가 = Σ(구성품 공급가 × 세트당 수량). 세트는 상품 자체 재고연동 없음(inventoryItemId="").
  const supplyPrice = isSet
    ? components.reduce((s, c) => s + c.supplyPrice * c.qtyPerUnit, 0)
    : singlePrice;
  const inventoryItemId = isSet ? "" : singleInv;
  // 재고 고정(초과발주 금지) — 재고 연동 단일 상품만. 세트·수기 상품은 늘 꺼짐(2026-10-17).
  const stockFixed = !isSet && !!inventoryItemId ? formData.get("stockFixed") === "true" : false;

  // 수량 규칙·안내 — 칸을 보냈을 때만 해석(undefined = 안 보냄 → 수정이면 그대로 둠, 새로 만들면 기본값).
  const minRaw = formData.get("minPerStore");
  const descRaw = formData.get("description");
  let minPerStore: number | null | undefined;
  if (minRaw !== null) {
    const r = parseMinInput(String(minRaw));
    if ("error" in r) return { error: r.error };
    minPerStore = r.value;
  }
  let description: string | undefined;
  if (descRaw !== null) {
    description = String(descRaw).replace(/\s+/g, " ").trim(); // 한 줄
    if (description.length > FLAT_DESC_MAX) {
      return { error: `안내 문구는 ${FLAT_DESC_MAX}자까지 넣을 수 있어요.` };
    }
  }

  if (!name) return { error: isSet ? "세트 이름을 넣어 주세요." : "상품명을 넣어 주세요." };
  if (!closeAt) return { error: "발주 마감 날짜와 시각을 넣어 주세요." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(pickupDate) || normalizeDateStr(pickupDate) !== pickupDate) {
    return { error: "출고일을 골라 주세요." };
  }
  if (pickupDate < kstDateOf(closeAt)) {
    return { error: "출고일은 발주 마감 날짜보다 앞설 수 없어요." };
  }
  if (!id) {
    // 새로 등록할 때만 — 지난 상품 수정(마감된 예약 목록)은 지난 마감 시각 그대로 저장할 수 있어야 한다.
    if (closeAt.getTime() <= Date.now()) return { error: "발주 마감 시각이 지났어요. 다시 골라 주세요." };
    if (dowOf(pickupDate) === 0) return { error: SUNDAY_MSG };
  }

  const componentData = components.map((c, i) => ({
    name: c.name,
    inventoryItemId: c.inventoryItemId,
    qtyPerUnit: c.qtyPerUnit,
    supplyPrice: c.supplyPrice,
    sortOrder: i,
  }));
  // 이번 저장이 쓰는 규칙·안내 칸(보낸 것만)
  const ruleData = {
    ...(minPerStore !== undefined ? { minPerStore } : {}),
    ...(description !== undefined ? { description } : {}),
  };

  const warnings: string[] = [];
  // 같은 출고일·같은 이름 진행 중 상품 — 출고·계산서는 이름으로 수량을 합치므로 알려만 주고 저장은 한다.
  const twin = await prisma.reservationProduct.findFirst({
    where: {
      ...(id ? { id: { not: id } } : {}),
      active: true,
      closeAt: { gt: new Date() },
      pickupDate,
      name,
    },
    select: { id: true },
  });
  if (twin) warnings.push("같은 출고일에 이름이 같은 공산품이 있어요. 출고할 때 수량이 합쳐져요.");

  let createdId: string | undefined;
  let moved: { userIds: string[]; fromDate: string } | null = null; // 출고일이 바뀌어 줄이 따라간 지점

  if (id) {
    // 확인과 저장을 한 트랜잭션에서 — 상품 행을 잠그고(FOR UPDATE) 예약 수를 센 뒤 저장한다.
    //  점주 발주·관리자 점포 수량 저장도 같은 행을 잠그고(FOR SHARE) 연동을 다시 읽으므로,
    //  '예약 0건 확인' 직후 옛 연동으로 예약 줄이 생기는 틈이 없다.
    type EditOut = { fail: FlatProductState } | { moved: { userIds: string[]; fromDate: string } | null };
    const out = await prisma.$transaction(async (tx): Promise<EditOut> => {
      const fail = (error: string): EditOut => ({ fail: { error } });
      await tx.$executeRaw`SELECT id FROM "ReservationProduct" WHERE id = ${id} FOR UPDATE`;
      const existing = await tx.reservationProduct.findFirst({
        where: { id, closeAt: { not: null } },
        select: {
          id: true,
          name: true,
          inventoryItemId: true,
          pickupDate: true,
          minPerStore: true,
          components: { select: { name: true } },
        },
      });
      if (!existing) return fail("상품을 찾을 수 없어요.");
      const existingIsSet = existing.components.length > 0;

      // 이미 예약이 들어온 상품은 세트↔단일·단일 상품의 재고 연동을 바꾸지 않는다 — 예약 줄은 담을 때의
      //  연동(inventoryItemId)을 스냅샷으로 들고 있어, 상품만 바꾸면 홀드가 옛 재고에 남거나(유령 홀드·옛 재고
      //  잠금 풀림으로 초과판매) 두 번 잡힌다. 줄까지 옮기는 건 계산서 발행·취소와 얽혀 안전하지 않아 막고
      //  새 상품으로 등록하게 안내한다. 계산서 발행으로 '차감됨'이 된 줄도 센다(취소하면 홀드로 살아나므로).
      const typeChange = componentsProvided && existingIsSet !== isSet;
      const writesLink = componentsProvided || !existingIsSet; // 이번 저장이 상품 연동 칸을 쓰는가
      const relink = !existingIsSet && !isSet && writesLink && existing.inventoryItemId !== inventoryItemId;
      if (typeChange || relink) {
        const booked = await tx.reservationOrderItem.count({ where: { productId: id, qty: { gt: 0 } } });
        if (booked > 0) {
          if (typeChange) {
            return fail(
              existingIsSet
                ? "발주가 들어온 세트는 구성품을 모두 삭제할 수 없어요. 새로 등록해 주세요."
                : "발주가 들어온 상품은 세트로 바꿀 수 없어요. 새로 등록해 주세요.",
            );
          }
          return fail(
            !inventoryItemId
              ? "발주가 들어온 상품은 재고 연동을 해제할 수 없어요. 새로 등록해 주세요."
              : !existing.inventoryItemId
                ? "발주가 들어온 상품은 재고 연동을 추가할 수 없어요. 새로 등록해 주세요."
                : "발주가 들어온 상품은 재고 연동을 바꿀 수 없어요. 새로 등록해 주세요.",
          );
        }
      }

      // 최소 수량 — 보낸 칸은 새 값, 안 보낸 칸은 지금 값.
      const rule: FlatQtyRule = {
        minPerStore: minPerStore !== undefined ? minPerStore : existing.minPerStore,
      };
      const ruleChanged = rule.minPerStore !== existing.minPerStore;

      const dateChanged = pickupDate !== existing.pickupDate;
      if (dateChanged && dowOf(pickupDate) === 0) return fail(SUNDAY_MSG);

      const oldCompNames = existing.components.map((c) => c.name);

      // 연동·세트 상품은 옛 출고일 계산서를 발행하면 그 지점 확정 줄이 '차감됨'이 돼(계산서에 이 상품이 실렸는지와
      //  상관없이 그 날 그 지점 줄 전부) 새 날짜로 따라가지 못한다(아래 updateMany 는 차감 안 된 줄만). 말없이 옛 날짜에
      //  남아 새 날짜 출고·합본에서 빠지지 않게 막고 지점을 알려 준다(옛 계산서를 취소하면 풀린다).
      if (dateChanged) {
        const stuck = await tx.reservationOrderItem.findMany({
          where: {
            productId: id,
            qty: { gt: 0 },
            pickupDate: existing.pickupDate,
            stockDeductedAt: { not: null },
            ...CONFIRMED_ROW,
          },
          select: { order: { select: { user: { select: { storeName: true } } } } },
        });
        if (stuck.length > 0) {
          const stores = storeList(stuck.map((r) => r.order.user.storeName));
          return fail(
            `이전 출고일로 계산서를 발행한 지점이 있어 출고일을 바꿀 수 없어요 (${stores}). ` +
              "계산서를 취소한 뒤 바꿔 주세요.",
          );
        }
      }

      // 출고일을 바꾸면 아직 차감 안 된 줄이 새 날짜로 따라간다(아래 updateMany). 그런데 옛 출고일 계산서에
      //  이 상품이 이미 실렸으면(작성 중 포함, 취소 제외) 새 날짜 계산서에 또 채워져 두 번 청구·두 번 차감된다.
      //  → 그런 지점이 하나라도 있으면 막고 지점 이름을 알려 준다(그 계산서에서 줄을 뺀 뒤 다시 바꾸면 됨).
      //  확정 줄만 계산서에 실린다.
      const movingRows = await tx.reservationOrderItem.findMany({
        where: { productId: id, stockDeductedAt: null, qty: { gt: 0 }, pickupDate: { not: pickupDate } },
        select: {
          name: true,
          pickupDate: true,
          confirmedAt: true,
          order: { select: { userId: true, confirmed: true } },
        },
      });
      const billable = movingRows.filter((r) => r.confirmedAt || r.order.confirmed);
      const billedOld = await billedStores(tx, billable, oldCompNames);
      if (billedOld) {
        return fail(
          `이전 출고일 계산서에 들어간 지점이 있어 출고일을 바꿀 수 없어요 (${billedOld}). ` +
            "계산서에서 이 상품을 삭제한 뒤 바꿔 주세요.",
        );
      }

      // 이름(세트는 구성품 이름 — 계산서엔 구성품 이름으로 실림)을 바꾸면 차감 안 된 줄 이름도 따라 바뀐다(아래 updateMany).
      //  그 줄 출고일 계산서에 옛 이름으로 이미 실렸으면 같은 날 불러오기·자동 채움이 새 이름으로 또 넣고(두 번 청구),
      //  다음에 출고일을 바꿀 때 위 검사도 이름이 안 맞아 지나간다 → 출고 전(오늘 이후) 줄에 그런 계산서가 있으면 막는다.
      const nameKey = (ns: string[]) => ns.map((n) => n.trim()).sort().join("\n");
      const renamed = existingIsSet
        ? componentsProvided && nameKey(oldCompNames) !== nameKey(components.map((c) => c.name))
        : name !== existing.name;
      if (renamed) {
        const rows = await tx.reservationOrderItem.findMany({
          where: {
            productId: id,
            stockDeductedAt: null,
            qty: { gt: 0 },
            pickupDate: { gte: kstTodayStr() },
            ...CONFIRMED_ROW,
          },
          select: { name: true, pickupDate: true, order: { select: { userId: true } } },
        });
        const billedNow = await billedStores(tx, rows, oldCompNames);
        if (billedNow) {
          return fail(
            `계산서에 들어간 지점이 있어 상품명을 바꿀 수 없어요 (${billedNow}). ` +
              "계산서에서 이 상품을 삭제한 뒤 바꿔 주세요.",
          );
        }
      }

      if (componentsProvided) {
        // 구성품을 관리하는 폼(관리자 세트 폼) — 구성품 전량 교체(삭제 후 재생성), 세트가/연동도 구성품 기준.
        await tx.reservationProduct.update({
          where: { id },
          data: { name, closeAt, pickupDate, supplyPrice, inventoryItemId, stockFixed, active: true, ...ruleData },
        });
        await tx.reservationProductComponent.deleteMany({ where: { productId: id } });
        if (componentData.length > 0) {
          await tx.reservationProductComponent.createMany({ data: componentData.map((c) => ({ ...c, productId: id })) });
        }
      } else {
        // 구성품 필드가 없는 폼(옛 폼) — 구성품을 건드리지 않는다.
        //  세트면 가격·연동·재고고정은 '구성품 기준'이라 이 폼에서 덮어쓰지 않고, 보낸 필드만(이름·마감·출고일) 수정한다.
        //  단일 상품이면 기존처럼 입력값(가격·연동·재고고정)을 반영.
        await tx.reservationProduct.update({
          where: { id },
          data: {
            name,
            closeAt,
            pickupDate,
            active: true,
            ...ruleData,
            ...(existingIsSet ? {} : { supplyPrice, inventoryItemId, stockFixed }),
          },
        });
      }
      // 출고일/이름 변경분을 미차감 예약 스냅샷에 전파(자동로드 필터 정합).
      await tx.reservationOrderItem.updateMany({
        where: { productId: id, stockDeductedAt: null },
        data: { pickupDate, name },
      });

      // 최소 수량을 바꿨으면 — 이미 들어온 확정 줄은 그대로 두되(편성과 같은 규칙), 새 최소보다 적은 지점 수만 알려 준다.
      if (ruleChanged) {
        const rows = await tx.reservationOrderItem.findMany({
          where: { productId: id, qty: { gt: 0 }, ...CONFIRMED_ROW },
          select: { qty: true },
        });
        const off = rows.filter((r) => flatQtyProblem(r.qty, 0, rule) !== null).length;
        if (off > 0) warnings.push(`수량 확인이 필요한 지점이 ${off}곳 있어요.`);
      }
      return {
        moved:
          movingRows.length > 0
            ? { userIds: [...new Set(movingRows.map((r) => r.order.userId))], fromDate: existing.pickupDate }
            : null,
      };
    });
    if ("fail" in out) return out.fail;
    moved = out.moved;
  } else {
    const batchId = await getOrCreateFlatBatchId();
    const maxAgg = await prisma.reservationProduct.aggregate({
      where: { batchId },
      _max: { sortOrder: true },
    });
    const created = await prisma.reservationProduct.create({
      data: {
        batchId,
        name,
        closeAt,
        pickupDate,
        supplyPrice,
        inventoryItemId,
        stockFixed,
        ...ruleData,
        sortOrder: (maxAgg._max.sortOrder ?? 0) + 1,
        active: true,
        ...(componentData.length > 0 ? { components: { create: componentData } } : {}),
      },
      select: { id: true },
    });
    createdId = created.id;
  }

  // 출고일이 바뀌어 줄이 따라갔으면 — 그 상품을 발주한 지점에만 알림.
  if (moved) await notifyFlatShipmentMoved(moved.userIds, name, pickupDate);

  await writeAudit({
    action: id ? "reservation.flatUpdate" : "reservation.flatCreate",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "ReservationProduct",
    targetId: id || createdId || "",
    summary: `공산품 ${name} · 출고 ${pickupDate}${moved ? ` (${moved.fromDate}에서 옮김)` : ""}`,
  }).catch(() => {});

  revalidatePath("/admin/reservations");
  revalidatePath("/admin/reservations/closed");
  revalidatePath("/admin/reservations/pickup-closed");
  revalidatePath("/reservations");
  revalidatePath("/admin/calendar");
  if (moved) {
    // 출고일이 옮겨지면 스냅샷을 읽는 출고·발주 화면도 무효화(옛 날짜에서 빠지고 새 날짜에 뜨게).
    revalidatePath("/order");
    revalidatePath("/vendor");
    revalidatePath("/vendor/summary");
    revalidatePath("/admin/hotdeal");
  }
  return {
    ok: true,
    ...(createdId ? { id: createdId } : {}),
    ...(warnings.length > 0 ? { warning: warnings.join(" ") } : {}),
  };
}

// ── 점주(핫딜마켓) 공산품 발주 — 품목별 발주(저장+확정 한 번) + 재고연동 실시간 담기 ───────────

// 수기 상품 발주 = 수량 저장 + 품목별 확정(confirmedAt) 한 번에. qty<=0 이면 발주 취소(행 삭제). 마감 전에만.
// 수량이 바뀌면 최소 수량 검사 — '지금 저장된 내 수량'은 확정분(미확정 줄이면 0).
export async function confirmFlatProductAction(input: {
  productId: string;
  qty: number;
}): Promise<{ ok: boolean; error?: string }> {
  const { user, error: gateError } = await requireHotdealMerchant();
  if (!user) return { ok: false, error: gateError };
  const productId = String(input?.productId ?? "");
  const qty = Math.min(99999, Math.max(0, Math.floor(Number(input?.qty) || 0))); // 상한(오타·폭주 방지)

  const product = await prisma.reservationProduct.findFirst({
    where: { id: productId, active: true, closeAt: { not: null }, batch: { active: true } },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      closeAt: true,
      batchId: true,
      inventoryItemId: true,
      minPerStore: true,
      description: true,
      components: { where: { inventoryItemId: { not: "" } }, select: { id: true } },
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: CLOSED_MSG };
  }
  // 연동 세트(연동 구성품 보유)도 재고연동 단일처럼 '담아둔 수량 확정'. 수기(단일·수기전용 세트)만 수량 직접 저장.
  const isLinked = !!product.inventoryItemId || product.components.length > 0;

  // 쓰기는 한 트랜잭션에서 — 상품 행을 함께 잠그고 연동 여부를 다시 확인(관리자가 막 수기↔연동을 바꿨으면 거절).
  const out = await prisma.$transaction(async (tx): Promise<{ ok: boolean; error?: string }> => {
    const now = await lockProductLink(tx, productId);
    const nowLinked = !!now?.inventoryItemId || (now?.components.length ?? 0) > 0;
    if (!now || nowLinked !== isLinked || !sameSnapshot(product, now)) return { ok: false, error: PRODUCT_CHANGED };
    const rule: FlatQtyRule = { minPerStore: now.minPerStore };

    const found = await tx.reservationOrder.findUnique({
      where: { userId_batchId: { userId: user.id, batchId: product.batchId } },
      select: { id: true, confirmed: true },
    });
    if (found) await lockMyItem(tx, found.id, productId);
    const mine = found
      ? await tx.reservationOrderItem.findUnique({
          where: { orderId_productId: { orderId: found.id, productId } },
          select: { qty: true, confirmedAt: true },
        })
      : null;
    // 출고·계산서로 나가고 있는 내 수량(확정분). 미확정 줄은 0으로 보고 검사한다.
    const confirmedQty = mine && (mine.confirmedAt || found?.confirmed) ? mine.qty : 0;

    if (isLinked) {
      // 재고연동(단일/세트) — 수량은 담기(hold)가 관리. 담아둔 수량을 '발주 확정'만 한다(옛 화면 호환).
      if (!found || !mine || mine.qty <= 0) return { ok: false, error: "수량을 먼저 골라 주세요." };
      const problem = flatQtyProblem(mine.qty, confirmedQty, rule);
      if (problem) return { ok: false, error: problem };
      await tx.reservationOrderItem.update({
        where: { orderId_productId: { orderId: found.id, productId } },
        data: { confirmedAt: new Date() },
      });
      return { ok: true };
    }
    if (qty <= 0) {
      // 발주 취소(0은 규칙과 상관없이 항상 허용)
      if (found) await tx.reservationOrderItem.deleteMany({ where: { orderId: found.id, productId } });
      return { ok: true };
    }
    const problem = flatQtyProblem(qty, confirmedQty, rule);
    if (problem) return { ok: false, error: problem };
    const order = await tx.reservationOrder.upsert({
      where: { userId_batchId: { userId: user.id, batchId: product.batchId } },
      create: { userId: user.id, batchId: product.batchId },
      update: {},
      select: { id: true },
    });
    await tx.reservationOrderItem.upsert({
      where: { orderId_productId: { orderId: order.id, productId } },
      create: {
        orderId: order.id,
        productId,
        name: product.name,
        supplyPrice: product.supplyPrice,
        pickupDate: product.pickupDate,
        inventoryItemId: "",
        qty,
        confirmedAt: new Date(),
      },
      update: {
        qty,
        confirmedAt: new Date(),
        name: product.name,
        supplyPrice: product.supplyPrice,
        pickupDate: product.pickupDate,
      },
    });
    return { ok: true };
  });
  if (!out.ok) return out;
  revalidatePath("/reservations");
  revalidatePath("/order");
  return { ok: true };
}

// 수정 = 품목별 확정 해제(confirmedAt=null, 수량 유지). 마감 전에만.
// ※ 새 화면은 [변경 저장]으로 바로 고치므로 쓰지 않는다 — 배포 순간 열려 있던 옛 화면용으로만 남김.
export async function unlockFlatProductAction(input: {
  productId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { user, error: gateError } = await requireHotdealMerchant();
  if (!user) return { ok: false, error: gateError };
  const productId = String(input?.productId ?? "");
  const product = await prisma.reservationProduct.findFirst({
    // 수기·연동 공통. 연동도 발주 확정(confirmedAt)을 쓰므로 잠금해제 가능(수량 홀드는 유지).
    where: { id: productId, active: true, closeAt: { not: null } },
    select: { closeAt: true },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: CLOSED_MSG };
  }
  await prisma.reservationOrderItem.updateMany({
    where: { productId, order: { userId: user.id } },
    data: { confirmedAt: null },
  });
  revalidatePath("/reservations");
  revalidatePath("/order");
  return { ok: true };
}

// 재고연동 상품 실시간 담기 = 즉시 홀드(qty=홀드). 마감 전·재고 캡. qty0=발주 취소(줄 삭제).
//  confirm=true(또는 "1") — '확정까지': 같은 트랜잭션에서 저장 + confirmedAt 을 찍는다(새 화면의 [발주하기]/[변경 저장]).
//  confirm 없이 부르면 옛 화면처럼 담기만(확정은 confirmFlatProductAction). 단 이미 확정된 줄의 수량을 바꾸면
//  확정 상태 그대로 바뀌므로 그때도 수량 규칙을 검사한다.
export async function holdFlatProductAction(input: {
  productId: string;
  qty: number;
  confirm?: boolean | string;
}): Promise<ResvHoldResult> {
  const { user, error: gateError } = await requireHotdealMerchant();
  if (!user) return { ok: false, error: gateError };
  const productId = String(input?.productId ?? "");
  const qty = Math.min(99999, Math.max(0, Math.floor(Number(input?.qty) || 0))); // 상한(오타·폭주 방지)
  const confirm = input?.confirm === true || input?.confirm === "1";

  const product = await prisma.reservationProduct.findFirst({
    where: {
      id: productId,
      active: true,
      closeAt: { not: null },
      batch: { active: true },
    },
    select: {
      name: true,
      supplyPrice: true,
      pickupDate: true,
      inventoryItemId: true,
      closeAt: true,
      batchId: true,
      stockFixed: true,
      minPerStore: true,
      description: true,
      components: {
        where: { inventoryItemId: { not: "" } },
        select: { inventoryItemId: true, qtyPerUnit: true },
      },
    },
  });
  if (!product) return { ok: false, error: "상품을 찾을 수 없어요." };
  if (Date.now() >= (product.closeAt as Date).getTime()) {
    return { ok: false, error: CLOSED_MSG };
  }

  // 세트(연동 구성품 보유) — 구성품 전부 잠그고 '만들 수 있는 세트 수'(구성품별 최소)로 판정, 세트 주문행 1개 저장.
  if (product.components.length > 0) {
    return holdSetProduct(user.id, productId, qty, product, confirm);
  }
  if (!product.inventoryItemId) {
    return { ok: false, error: "잘못된 요청이에요." }; // 수기 단일은 confirmFlatProductAction 으로 처리
  }
  const itemId = product.inventoryItemId;

  try {
    const res = await prisma.$transaction(async (tx): Promise<ResvHoldResult> => {
      // 잠금 순서: 상품 행(공유) → 재고 행. 관리자가 막 연동·종류를 바꿨으면 옛 연동으로 담지 않는다.
      const now = await lockProductLink(tx, productId);
      if (!now || now.inventoryItemId !== itemId || now._count.components > 0 || !sameSnapshot(product, now)) {
        return { ok: false, error: PRODUCT_CHANGED };
      }
      const rule: FlatQtyRule = { minPerStore: now.minPerStore };
      await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${itemId} FOR UPDATE`;
      const item = await tx.inventoryItem.findUnique({
        where: { id: itemId },
        select: { qty: true, deletedAt: true },
      });
      if (!item || item.deletedAt) return { ok: false, error: "연동된 재고를 찾을 수 없어요." };

      // 이 품목에 걸린 '아직 차감 안 된' 전체 예약홀드(연동·활성배치·flat+레거시) − 내 이 상품 현재 수량.
      // ⚠ pickupDate 기준으로 거르면 당일픽업 상품이 10시 이후 자기 홀드를 제외해 초과판매가 나므로,
      //   stockDeductedAt:null(=아직 재고에서 안 뺀 살아있는 홀드) 기준으로 센다(재고현황 시드와 동일).
      const resvRows = await tx.reservationOrderItem.findMany({
        where: {
          inventoryItemId: itemId,
          stockDeductedAt: null,
          qty: { gt: 0 },
          pickupDate: { gte: minLockedPickupDate() }, // 픽업 지난 홀드는 자동 해제(집계 제외)
          order: { batch: { active: true } },
        },
        select: { qty: true, productId: true, order: { select: { userId: true } } },
      });
      let resvHeld = 0;
      let myThis = 0;
      for (const r of resvRows) {
        resvHeld += r.qty;
        if (r.order.userId === user.id && r.productId === productId) myThis += r.qty;
      }
      const dayAgg = await tx.stockHold.aggregate({
        where: { itemId, windowDate: windowKeyAt() },
        _sum: { qty: true },
      });
      const availableForMe = item.qty - (resvHeld - myThis) - (dayAgg._sum.qty ?? 0);

      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId: user.id, batchId: product.batchId } },
        select: { id: true, confirmed: true },
      });
      if (order) await lockMyItem(tx, order.id, productId);
      if (qty <= 0) {
        if (order)
          await tx.reservationOrderItem.deleteMany({ where: { orderId: order.id, productId } });
        return { ok: true, available: Math.max(0, availableForMe) };
      }
      // 수량 규칙 — 이번에 확정하거나(confirm) 이미 확정된 줄의 수량을 바꿀 때. 수량이 그대로면 검사 안 함.
      const mine = order
        ? await tx.reservationOrderItem.findUnique({
            where: { orderId_productId: { orderId: order.id, productId } },
            select: { qty: true, confirmedAt: true },
          })
        : null;
      const wasConfirmed = !!mine && (!!mine.confirmedAt || !!order?.confirmed);
      if (confirm || wasConfirmed) {
        const problem = flatQtyProblem(qty, wasConfirmed && mine ? mine.qty : 0, rule);
        if (problem) return { ok: false, error: problem, available: Math.max(0, availableForMe) };
      }
      // 재고 고정 상품만 재고까지 하드 캡. 기본(초과발주 허용)은 재고 넘어도 담긴다(부족분=관리자 조달).
      // 단 '줄이기'(qty ≤ 내 현재수량 myThis)는 항상 허용 — 같은 재고를 쓰는 다른 상품이 초과발주해
      // availableForMe 가 음수여도 내 수량을 낮추는 건 재고를 더 쓰지 않으므로 막지 않는다.
      if (product.stockFixed && qty > myThis && qty > availableForMe) {
        return {
          ok: false,
          error: `재고가 부족해요 (최대 ${Math.max(myThis, availableForMe)}개)`,
          available: Math.max(0, availableForMe),
        };
      }
      const oid =
        order?.id ??
        (
          await tx.reservationOrder.create({
            data: { userId: user.id, batchId: product.batchId },
            select: { id: true },
          })
        ).id;
      // 담기 = 재고 홀드(qty). confirm 이면 같은 쓰기에서 '발주 확정'(confirmedAt)까지.
      await tx.reservationOrderItem.upsert({
        where: { orderId_productId: { orderId: oid, productId } },
        create: {
          orderId: oid,
          productId,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: itemId,
          qty,
          confirmedAt: confirm ? new Date() : null,
        },
        update: {
          qty,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: itemId,
          ...(confirm ? { confirmedAt: new Date() } : {}),
        },
      });
      return { ok: true, available: Math.max(0, availableForMe - qty) };
    });
    revalidatePath("/reservations");
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("reservation.holdFlat", err, { productId, userId: user.id });
    return { ok: false, error: "저장에 실패했어요. 다시 시도해 주세요." };
  }
}

// 세트 담기 — 연동 구성품 전부 FOR UPDATE 잠그고 '만들 수 있는 세트 수'(구성품별 남은÷세트당수량 중 최소)로 판정.
// 세트 주문행 1개(inventoryItemId="")만 저장(수량=세트수). 재고 홀드는 reservation-stock 의 setComponentDemand 가 전개 집계.
// confirm=true 면 같은 쓰기에서 확정(confirmedAt)까지 — 규칙 검사는 holdFlatProductAction 과 같다.
async function holdSetProduct(
  userId: string,
  productId: string,
  qtySets: number,
  product: {
    name: string;
    supplyPrice: number;
    pickupDate: string;
    batchId: string;
    stockFixed: boolean;
    minPerStore: number | null;
    description: string;
    components: { inventoryItemId: string; qtyPerUnit: number }[];
  },
  confirm: boolean,
): Promise<ResvHoldResult> {
  const comps = product.components;
  const itemIds = [...new Set(comps.map((c) => c.inventoryItemId))];
  try {
    const res = await prisma.$transaction(async (tx): Promise<ResvHoldResult> => {
      // 잠금 순서: 상품 행(공유) → 구성품 재고 행. 그 사이 구성품·종류가 바뀌었으면 옛 구성품으로 판정하지 않는다.
      const now = await lockProductLink(tx, productId);
      const sig = (cs: { inventoryItemId: string; qtyPerUnit: number }[]) =>
        cs.map((c) => `${c.inventoryItemId}:${c.qtyPerUnit}`).sort().join(",");
      if (
        !now ||
        now.inventoryItemId ||
        now.components.length === 0 ||
        sig(now.components) !== sig(comps) ||
        !sameSnapshot(product, now)
      ) {
        return { ok: false, error: PRODUCT_CHANGED };
      }
      const rule: FlatQtyRule = { minPerStore: now.minPerStore };
      for (const id of itemIds) {
        await tx.$executeRaw`SELECT id FROM "InventoryItem" WHERE id = ${id} FOR UPDATE`;
      }
      const invs = await tx.inventoryItem.findMany({
        where: { id: { in: itemIds } },
        select: { id: true, qty: true, deletedAt: true },
      });
      const baseById = new Map(invs.map((i) => [i.id, i]));
      for (const id of itemIds) {
        const inv = baseById.get(id);
        if (!inv || inv.deletedAt) return { ok: false, error: "연동된 재고를 찾을 수 없어요." };
      }

      // 활성 세트 전부 + 연동 구성품(세트별 item→세트당수량) — 세트 홀드를 구성품으로 전개해 합산.
      const allSets = await tx.reservationProduct.findMany({
        where: { active: true, components: { some: { inventoryItemId: { not: "" } } } },
        select: {
          id: true,
          components: { where: { inventoryItemId: { not: "" } }, select: { inventoryItemId: true, qtyPerUnit: true } },
        },
      });
      const compMap = new Map(allSets.map((s) => [s.id, s.components]));
      const setIds = allSets.map((s) => s.id);
      const gate = minLockedPickupDate(); // 픽업 지난 홀드는 자동 해제(집계 제외)
      const live: Prisma.ReservationOrderItemWhereInput = {
        stockDeductedAt: null,
        qty: { gt: 0 },
        pickupDate: { gte: gate },
        order: { batch: { active: true } },
      };
      const [singleRows, setRows, dayHolds] = await Promise.all([
        tx.reservationOrderItem.findMany({
          where: { inventoryItemId: { in: itemIds }, ...live },
          select: { inventoryItemId: true, qty: true },
        }),
        tx.reservationOrderItem.findMany({
          where: { productId: { in: setIds }, ...live },
          select: { productId: true, qty: true, order: { select: { userId: true } } },
        }),
        tx.stockHold.groupBy({
          by: ["itemId"],
          where: { itemId: { in: itemIds }, windowDate: windowKeyAt() },
          _sum: { qty: true },
        }),
      ]);
      const dayById = new Map(dayHolds.map((d) => [d.itemId, d._sum.qty ?? 0]));
      const totalHeld: Record<string, number> = {};
      const myThis: Record<string, number> = {};
      let myCurrentSets = 0;
      for (const r of singleRows) totalHeld[r.inventoryItemId] = (totalHeld[r.inventoryItemId] ?? 0) + r.qty;
      for (const r of setRows) {
        const cs = compMap.get(r.productId) ?? [];
        const mineThisSet = r.order.userId === userId && r.productId === productId;
        if (mineThisSet) myCurrentSets += r.qty;
        for (const c of cs) {
          totalHeld[c.inventoryItemId] = (totalHeld[c.inventoryItemId] ?? 0) + r.qty * c.qtyPerUnit;
          if (mineThisSet) myThis[c.inventoryItemId] = (myThis[c.inventoryItemId] ?? 0) + r.qty * c.qtyPerUnit;
        }
      }
      let availableSets = Infinity;
      for (const c of comps) {
        const base = baseById.get(c.inventoryItemId)!.qty;
        const others = (totalHeld[c.inventoryItemId] ?? 0) - (myThis[c.inventoryItemId] ?? 0);
        const remain = base - others - (dayById.get(c.inventoryItemId) ?? 0);
        availableSets = Math.min(availableSets, Math.floor(remain / Math.max(1, c.qtyPerUnit)));
      }
      if (!Number.isFinite(availableSets)) availableSets = 0;

      const order = await tx.reservationOrder.findUnique({
        where: { userId_batchId: { userId, batchId: product.batchId } },
        select: { id: true, confirmed: true },
      });
      if (order) await lockMyItem(tx, order.id, productId);
      if (qtySets <= 0) {
        if (order) await tx.reservationOrderItem.deleteMany({ where: { orderId: order.id, productId } });
        return { ok: true, available: Math.max(0, availableSets) };
      }
      // 수량 규칙 — 이번에 확정하거나 이미 확정된 줄의 수량을 바꿀 때(수량이 그대로면 검사 안 함).
      const mine = order
        ? await tx.reservationOrderItem.findUnique({
            where: { orderId_productId: { orderId: order.id, productId } },
            select: { qty: true, confirmedAt: true },
          })
        : null;
      const wasConfirmed = !!mine && (!!mine.confirmedAt || !!order?.confirmed);
      if (confirm || wasConfirmed) {
        const problem = flatQtyProblem(qtySets, wasConfirmed && mine ? mine.qty : 0, rule);
        if (problem) return { ok: false, error: problem, available: Math.max(0, availableSets) };
      }
      // 재고 고정이면 세트 재고까지만(증가 시). 줄이기는 항상 허용.
      if (product.stockFixed && qtySets > myCurrentSets && qtySets > availableSets) {
        return {
          ok: false,
          error: `재고가 부족해요 (최대 ${Math.max(myCurrentSets, availableSets)}세트)`,
          available: Math.max(0, availableSets),
        };
      }
      const oid =
        order?.id ??
        (await tx.reservationOrder.create({ data: { userId, batchId: product.batchId }, select: { id: true } })).id;
      await tx.reservationOrderItem.upsert({
        where: { orderId_productId: { orderId: oid, productId } },
        create: {
          orderId: oid,
          productId,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: "",
          qty: qtySets,
          confirmedAt: confirm ? new Date() : null,
        },
        update: {
          qty: qtySets,
          name: product.name,
          supplyPrice: product.supplyPrice,
          pickupDate: product.pickupDate,
          inventoryItemId: "",
          ...(confirm ? { confirmedAt: new Date() } : {}),
        },
      });
      return { ok: true, available: Math.max(0, availableSets - qtySets) };
    });
    revalidatePath("/reservations");
    revalidatePath("/inventory");
    revalidatePath("/order");
    return res;
  } catch (err) {
    logError("reservation.holdSet", err, { productId, userId });
    return { ok: false, error: "저장에 실패했어요. 다시 시도해 주세요." };
  }
}
