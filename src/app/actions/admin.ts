"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { kstDayRange, kstDateOf, normalizeExpiry, shipmentDayOf } from "@/lib/date";
import {
  safePushInventory,
  setInventoryPushPending,
  readInventorySheet,
  lastInventoryPushAt,
  inventoryPushPending,
} from "@/lib/inventory-sheet";
import { getServiceAccount } from "@/lib/google-auth";
import { categorizeInventory, type CatGroup } from "@/lib/inventory-category";
import {
  snapshotInventory,
  listInventorySnapshots,
  restoreInventorySnapshot,
  type SnapshotMeta,
} from "@/lib/inventory-backup";
import {
  currentWindowStartUtc,
  currentDeadlineUtc,
} from "@/lib/schedule";
import { hasOrderWindow } from "@/lib/deadline";
import { restoreStockForOrder } from "@/lib/stock-hold";
import {
  notifyMerchantOrdersCancelled,
  notifyMerchantSignupApproved,
  notifyMerchantSignupRejected,
} from "@/lib/push";
import { writeAudit } from "@/lib/audit";
import {
  ALL_ROLES,
  ASSIGNABLE_MERCHANT_ROLES,
  type Role,
  type Status,
} from "@/lib/constants";

const EDITABLE_STATUSES: Status[] = ["APPROVED", "SUSPENDED", "PENDING", "REJECTED"];

export type MemberFormState = { ok?: boolean; error?: string };

// 회원 개인정보 + 역할 + 승인상태 수정
export async function updateMemberAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return { error: "잘못된 요청이에요." };

  const storeName = String(formData.get("storeName") ?? "").trim().slice(0, 100);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 40);
  const address = String(formData.get("address") ?? "").trim().slice(0, 200);
  let role = String(formData.get("role") ?? "") as Role;
  let status = String(formData.get("status") ?? "") as Status;

  // 본인(관리자) 계정은 역할/상태를 낮춰 스스로 잠그지 못하게 안전값으로 고정한다.
  // ⚠️ 반드시 아래 유효성 검사보다 '먼저' — 본인 편집 화면에선 역할/상태 select가 disabled라
  // 브라우저가 값을 아예 전송하지 않는다. 검증을 먼저 하면 role="" 이라 항상
  // '올바르지 않은 역할이에요'로 실패해, 관리자가 자기 상호/연락처/주소/입금자명을 못 고쳤다.
  if (userId === admin.id) {
    role = "ADMIN_SAEROP";
    status = "APPROVED";
  }

  // 입금자명 — 콤마/줄바꿈으로 여러 개, 중복·공백 정리
  const payerNames = [
    ...new Set(
      String(formData.get("payerNames") ?? "")
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.slice(0, 60)),
    ),
  ].slice(0, 20);

  if (!ALL_ROLES.includes(role)) return { error: "올바르지 않은 역할이에요." };
  if (!EDITABLE_STATUSES.includes(status)) return { error: "올바르지 않은 상태예요." };
  if (!storeName) return { error: "상호명을 입력하세요." };

  // '정상(APPROVED)' 상태는 반드시 배정된 역할이 있어야 한다. 역할 미배정(APPLICANT)+APPROVED는
  // 홈 경로가 없어 로그인 후 무한 리다이렉트로 계정이 영구 잠긴다 → 원천 차단.
  if (status === "APPROVED" && role === "APPLICANT") {
    return {
      error:
        "‘정상’ 상태로 두려면 역할을 먼저 지정하세요. (‘가입 대기’ 역할로는 정상 상태가 될 수 없어요)",
    };
  }

  // 변경 전 값(감사로그용) — 역할/상태가 바뀌면 '누가·언제·무엇을' 남긴다.
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, storeName: true, username: true },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { storeName, phone, address, role, status, payerNames },
  });

  // 권한 상승·정지 등 계정 조작은 추적 가능해야 한다(단순 정보 수정은 로그 남기지 않음).
  if (before && (before.role !== role || before.status !== status)) {
    await writeAudit({
      action: "member.update",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "user",
      targetId: userId,
      summary: `회원 변경: ${before.storeName}(${before.username}) · 역할 ${before.role}→${role} · 상태 ${before.status}→${status}`,
    });
  }
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
  return { ok: true };
}

// 정지/복구 토글
export async function setMemberStatusAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const status = String(formData.get("status") ?? "") as Status;
  if (!userId || !EDITABLE_STATUSES.includes(status)) return;
  if (userId === admin.id) return; // 본인 정지 금지
  const before = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true, status: true, storeName: true, username: true },
  });
  if (!before) return;
  // 역할 미배정(APPLICANT)을 APPROVED로 복구하면 로그인 후 락아웃 → 막는다(역할부터 지정해야 함).
  if (status === "APPROVED" && before.role === "APPLICANT") return;
  await prisma.user.update({ where: { id: userId }, data: { status } });
  if (before.status !== status) {
    await writeAudit({
      action: "member.status",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "user",
      targetId: userId,
      summary: `회원 상태 변경: ${before.storeName}(${before.username}) · ${before.status}→${status}`,
    });
  }
  revalidatePath("/admin/members");
  revalidatePath(`/admin/members/${userId}`);
}

// 회원 삭제 — 본인 제외. 발주 이력(+항목)도 함께 삭제(되돌릴 수 없음).
export async function deleteMemberAction(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId || userId === admin.id) return; // 본인 삭제 금지

  // 삭제 전 스냅샷(복구 참고용) — 회원 요약 + 함께 지워질 데이터 건수
  const victim = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, username: true, storeName: true, phone: true, address: true,
      role: true, status: true, payerNames: true, createdAt: true,
      _count: {
        select: {
          orders: true,
          invoices: true,
          weeklyOrders: true,
          reservationOrders: true,
        },
      },
    },
  });
  if (!victim) return; // 이미 없는 회원

  // 회원을 참조하는 모든 소유 데이터를 먼저 지워야 user.delete 가 FK 제약에 막히지 않는다.
  // (이전엔 발주(Order)만 지워, 계산서·주간발주·예약발주·재고담기가 있는 회원은 삭제가 실패했다.)
  // - Invoice/WeeklyOrder/ReservationOrder/Order: 각자의 항목(Item)은 onDelete:Cascade 로 함께 삭제.
  // - StockHold: 담기 홀드(임시).
  // - Notification/PushSubscription/ChatThread: User FK 가 Cascade 라 user.delete 시 자동 삭제.
  // - Deposit(matchedUserId): onDelete:SetNull — 실제 은행 입금 기록은 보존하고 매칭만 해제.
  await prisma.$transaction([
    prisma.invoice.deleteMany({ where: { userId } }),
    prisma.weeklyOrder.deleteMany({ where: { userId } }),
    prisma.reservationOrder.deleteMany({ where: { userId } }),
    prisma.stockHold.deleteMany({ where: { userId } }),
    prisma.order.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
  ]);
  await writeAudit({
    action: "member.delete",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "user",
    targetId: userId,
    summary: `회원 삭제: ${victim.storeName}(${victim.username}) · 발주 ${victim._count.orders} · 계산서 ${victim._count.invoices} · 주간 ${victim._count.weeklyOrders} · 예약 ${victim._count.reservationOrders}건 함께 삭제`,
    snapshot: victim,
  });
  revalidatePath("/admin/members");
  redirect("/admin/members");
}

// 비밀번호 초기화(관리자가 새 비번 지정)
export async function resetMemberPasswordAction(
  _prev: MemberFormState,
  formData: FormData,
): Promise<MemberFormState> {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const pw = String(formData.get("password") ?? "");
  if (!userId) return { error: "잘못된 요청이에요." };
  if (pw.length < 4) return { error: "비밀번호는 4자 이상으로 정해주세요." };
  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { storeName: true, username: true },
  });
  const passwordHash = await bcrypt.hash(pw, 10);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
  // 비밀번호 '값'은 절대 남기지 않고, 초기화가 있었다는 사실만 기록.
  await writeAudit({
    action: "member.passwordReset",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "user",
    targetId: userId,
    summary: `비밀번호 초기화: ${target?.storeName ?? ""}(${target?.username ?? userId})`,
  });
  revalidatePath(`/admin/members/${userId}`);
  return { ok: true };
}

export async function approveUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as Role;
  if (!userId || !ASSIGNABLE_MERCHANT_ROLES.includes(role)) return;
  await prisma.user.update({
    where: { id: userId },
    data: { role, status: "APPROVED" },
  });
  await notifyMerchantSignupApproved(userId).catch(() => {}); // Q7
  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
}

export async function rejectUserAction(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  if (!userId) return;
  await prisma.user.update({
    where: { id: userId },
    data: { status: "REJECTED" },
  });
  await notifyMerchantSignupRejected(userId).catch(() => {}); // Q7
  revalidatePath("/admin/approvals");
  revalidatePath("/admin");
}

// 재고 수량·공급가는 음수가 없다. 하이픈/음수 입력은 0으로 바닥 처리(음수 재고·시트 전파 방지).
const toInt = (v: FormDataEntryValue | null) =>
  Math.max(0, parseInt(String(v ?? "").replace(/[^0-9-]/g, ""), 10) || 0);

export async function addInventoryAction(formData: FormData) {
  await requireAdmin();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  // #20 품목명 / 남은수량 / 공급가
  const qty = toInt(formData.get("qty"));
  const supplyPrice = toInt(formData.get("supplyPrice"));
  const memo = String(formData.get("memo") ?? "").trim();
  // #9 유통기한 — "26-07-27"·"2026.7.27" 등을 "2026-07-27"로 정규화(형식 아니면 "" = 없음)
  const expiry = normalizeExpiry(String(formData.get("expiry") ?? ""));
  // 시트 동기화는 '품목명'을 키로 쓰므로 이름이 유일해야 한다. 같은 이름이 이미 있으면
  // 중복 생성 대신 그 품목을 갱신(재추가 = 수정). #22 리뷰(중복명 데이터 손실 방지)
  const dup = await prisma.inventoryItem.findFirst({
    where: { name, deletedAt: null },
    select: { id: true },
  });
  if (dup) {
    await prisma.inventoryItem.update({
      where: { id: dup.id },
      data: { qty, supplyPrice, ...(memo ? { memo } : {}), ...(expiry ? { expiry } : {}) },
    });
  } else {
    const max = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
    await prisma.inventoryItem.create({
      data: { name, qty, supplyPrice, memo, expiry, sortOrder: (max._max.sortOrder ?? 0) + 1 },
    });
  }
  await setInventoryPushPending(); // R3 변경 표시 → 다음 크론이 시트로 push(단방향)
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function updateInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const name = String(formData.get("name") ?? "").trim(); // #20 품목명도 수정
  const qty = toInt(formData.get("qty"));
  const supplyPrice = toInt(formData.get("supplyPrice"));
  await prisma.inventoryItem.update({
    where: { id },
    data: { ...(name ? { name } : {}), qty, supplyPrice },
  });
  await setInventoryPushPending(); // R3
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

export async function deleteInventoryAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await prisma.inventoryItem.delete({ where: { id } });
  await setInventoryPushPending(); // R3
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
}

// 엑셀(스프레드시트) 붙여넣기 일괄 반영 — 앱이 기준(원본). 시트를 고치는 게 아니라 앱에 직접 넣는다.
// 3열: 품목명 / 수량 / 공급가. '엑셀 목록으로 전체 교체'(붙여넣기에 없는 기존 품목은 삭제).
// - 이름을 키로 upsert(기존 품목은 id를 보존 → 담기 원장 연결 유지). sortOrder는 붙여넣은 순서.
// - StockHold.itemId는 FK가 아니라 품목 삭제/교체에도 원장은 보존된다(이름 스냅샷).
// - ⚠️ 빈 목록이면 아무것도 하지 않는다(전량 삭제 사고 방지). 시트 반영은 pending만(단방향, 다음 크론).
export type BulkInventoryResult = {
  ok: boolean;
  error?: string;
  added?: number;
  updated?: number;
  deleted?: number;
};
export async function bulkReplaceInventoryAction(
  payloadJson: string,
): Promise<BulkInventoryResult> {
  const admin = await requireAdmin();

  let rows: { name?: string; qty?: unknown; supplyPrice?: unknown; expiry?: unknown }[];
  try {
    rows = JSON.parse(String(payloadJson ?? "[]"));
  } catch {
    return { ok: false, error: "붙여넣은 내용을 읽지 못했어요. 다시 붙여넣어 주세요." };
  }
  if (!Array.isArray(rows)) return { ok: false, error: "형식이 올바르지 않아요." };

  // 문자/숫자 어느 쪽이 와도 안전하게 정수화
  const numOf = (v: unknown) => toInt(v == null ? null : String(v));
  // 정제 + 이름 기준 dedupe(첫 번째만 채택 — 이름이 동기화 키)
  const seen = new Set<string>();
  const clean: { name: string; qty: number; supplyPrice: number; expiry: string }[] = [];
  for (const r of rows) {
    const name = String(r.name ?? "").trim();
    if (!name) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    // #9 유통기한(선택 4열) — 정규화. 빈/형식오류면 ""(기존값 유지: 아래 update에서 미포함)
    clean.push({
      name,
      qty: numOf(r.qty),
      supplyPrice: numOf(r.supplyPrice),
      expiry: normalizeExpiry(String(r.expiry ?? "")),
    });
  }
  // 전량 삭제 사고 방지 — 빈 목록이면 거부(실수로 전체가 지워지는 것 차단)
  if (clean.length === 0) {
    return { ok: false, error: "붙여넣은 품목이 없어요. (안전을 위해 전체 삭제는 막았어요)" };
  }

  // 감사 #2: 붙여넣기(대량 교체)는 삭제/덮어쓰기가 크므로 실행 전 자동 백업.
  await snapshotInventory("자동 · 붙여넣기 전").catch(() => {});

  const current = await prisma.inventoryItem.findMany({
    select: { id: true, name: true },
  });
  const nameToId = new Map<string, string>();
  for (const it of current) if (!nameToId.has(it.name)) nameToId.set(it.name, it.id);

  const pastedNames = new Set(clean.map((c) => c.name));
  const keepIds = new Set<string>();
  for (const name of pastedNames) {
    const id = nameToId.get(name);
    if (id) keepIds.add(id);
  }
  // 삭제 대상: 붙여넣기에 없는 기존 품목 + 같은 이름 중복행(첫 id 외)
  const deleteRows = current.filter((it) => !keepIds.has(it.id));
  const deleteIds = deleteRows.map((it) => it.id);

  let added = 0;
  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      if (deleteIds.length) {
        await tx.inventoryItem.deleteMany({ where: { id: { in: deleteIds } } });
      }
      for (let i = 0; i < clean.length; i++) {
        const c = clean[i];
        const id = nameToId.get(c.name);
        if (id) {
          await tx.inventoryItem.update({
            where: { id },
            // 유통기한은 유효값이 있을 때만 갱신 — 3열만 붙여넣어도 기존 유통기한이 지워지지 않게.
            data: {
              qty: c.qty,
              supplyPrice: c.supplyPrice,
              sortOrder: i,
              ...(c.expiry ? { expiry: c.expiry } : {}),
            },
          });
          updated++;
        } else {
          await tx.inventoryItem.create({
            data: {
              name: c.name,
              qty: c.qty,
              supplyPrice: c.supplyPrice,
              sortOrder: i,
              expiry: c.expiry,
            },
          });
          added++;
        }
      }
    },
    { timeout: 20000 },
  );

  await setInventoryPushPending(); // 단방향: 다음 크론이 시트로 반영
  await writeAudit({
    action: "inventory.bulkReplace",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "inventory",
    targetId: "",
    summary: `재고 일괄 교체: 갱신 ${updated} · 신규 ${added} · 삭제 ${deleteIds.length}`,
    snapshot: {
      added,
      updated,
      deletedCount: deleteIds.length,
      deletedNames: deleteRows.map((it) => it.name).slice(0, 300),
    },
  });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, added, updated, deleted: deleteIds.length };
}

// ── 1회성 '시트 → 앱' 불러오기(명시적, 삭제 없음) ──
// 시트연동은 평소 단방향(앱→시트)이지만, 시트에 미리 입력해둔 재고를 처음 한 번 앱으로 가져올 때 사용.
// 이름 기준 upsert(신규 생성 + 기존 갱신)만 하고 '앱에만 있는 품목은 삭제하지 않는다'
// (단방향 전환 R3의 데이터손실 사고 방지 지침). 반영 후 push 크론이 DB→시트를 미러링한다.
export type SheetImportPreview =
  | {
      ok: true;
      sheetItems: number;
      willAdd: number;
      willUpdate: number;
      sample: { name: string; qty: number; supplyPrice: number; expiry: string }[];
    }
  | { ok: false; error: string };

const dedupSheetRows = <T extends { name: string }>(rows: T[]): T[] => {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const n = r.name.trim();
    if (!n || seen.has(n)) return false;
    seen.add(n);
    return true;
  });
};

export async function previewInventoryFromSheetAction(): Promise<SheetImportPreview> {
  await requireAdmin();
  const sheet = await readInventorySheet();
  if (!Array.isArray(sheet)) return { ok: false, error: sheet.error };
  const rows = dedupSheetRows(sheet);
  if (rows.length === 0)
    return { ok: false, error: "시트에서 품목을 못 읽었어요. (A열=품목명, 1행=헤더 확인)" };
  const current = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { name: true },
  });
  const curNames = new Set(current.map((c) => c.name));
  const willUpdate = rows.filter((r) => curNames.has(r.name.trim())).length;
  return {
    ok: true,
    sheetItems: rows.length,
    willAdd: rows.length - willUpdate,
    willUpdate,
    sample: rows.slice(0, 100).map((r) => ({
      name: r.name,
      qty: r.qty,
      supplyPrice: r.supplyPrice,
      expiry: normalizeExpiry(r.expiry) || r.expiry || "",
    })),
  };
}

export type SheetImportResult = { ok: boolean; added?: number; updated?: number; error?: string };

export async function importInventoryFromSheetAction(): Promise<SheetImportResult> {
  const admin = await requireAdmin();
  const sheet = await readInventorySheet();
  if (!Array.isArray(sheet)) return { ok: false, error: sheet.error };
  const rows = dedupSheetRows(sheet);
  if (rows.length === 0) return { ok: false, error: "시트에서 품목을 못 읽었어요." };

  const current = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  const nameToId = new Map(current.map((c) => [c.name, c.id]));
  const maxAgg = await prisma.inventoryItem.aggregate({ _max: { sortOrder: true } });
  let sort = (maxAgg._max.sortOrder ?? 0) + 1;
  let added = 0;
  let updated = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const r of rows) {
          const name = r.name.trim();
          const exp = normalizeExpiry(r.expiry); // 형식 맞으면 정규화, 아니면 "" (기존 유지)
          const id = nameToId.get(name);
          if (id) {
            await tx.inventoryItem.update({
              where: { id },
              data: { qty: r.qty, supplyPrice: r.supplyPrice, ...(exp ? { expiry: exp } : {}) },
            });
            updated++;
          } else {
            await tx.inventoryItem.create({
              data: { name, qty: r.qty, supplyPrice: r.supplyPrice, expiry: exp, sortOrder: sort++ },
            });
            added++;
          }
        }
      },
      { timeout: 20000 },
    );
  } catch (err) {
    console.error("[inventory] import from sheet failed:", err);
    return { ok: false, error: "불러오기 저장에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }

  await setInventoryPushPending(); // 다음 push 크론이 DB→시트 미러링
  await writeAudit({
    action: "inventory.importFromSheet",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "inventory",
    targetId: "",
    summary: `시트→앱 재고 불러오기: 신규 ${added} · 갱신 ${updated}(삭제 없음)`,
  });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, added, updated };
}

// ── 재고 카테고리 AI 자동 분류 ──
// 제안(propose): 재고 전체 이름을 AI(Claude)가 대분류/중분류로 나눠 미리보기용으로 반환. DB 무변경.
// 적용(apply): 관리자가 미리보기에서 확인한 매핑(mapJson)을 그대로 각 품목에 저장. 삭제 없음.
export type CategoryProposal =
  | {
      ok: true;
      groups: CatGroup[];
      mapJson: string;
      itemCount: number;
      majorCount: number;
    }
  | { ok: false; error: string };

export async function proposeInventoryCategoriesAction(): Promise<CategoryProposal> {
  await requireAdmin();
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { name: true },
  });
  const names = items.map((i) => i.name).filter(Boolean);
  if (names.length === 0) return { ok: false, error: "등록된 재고가 없어요." };
  const res = await categorizeInventory(names);
  if (!res.ok) return { ok: false, error: res.error };
  const majors = new Set(res.groups.map((g) => g.major));
  return {
    ok: true,
    groups: res.groups,
    mapJson: JSON.stringify(res.map),
    itemCount: names.length,
    majorCount: majors.size,
  };
}

export type CategoryApplyResult = { ok: boolean; updated?: number; error?: string };

export async function applyInventoryCategoriesAction(
  mapJson: string,
): Promise<CategoryApplyResult> {
  const admin = await requireAdmin();
  let map: Record<string, { major?: string; minor?: string }>;
  try {
    map = JSON.parse(String(mapJson ?? "{}"));
  } catch {
    return { ok: false, error: "적용할 분류를 읽지 못했어요." };
  }
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return { ok: false, error: "형식이 올바르지 않아요." };
  }
  const items = await prisma.inventoryItem.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true },
  });
  let updated = 0;
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const it of items) {
          const c = map[it.name];
          if (!c) continue;
          const major = String(c.major ?? "").trim().slice(0, 40);
          const minor = String(c.minor ?? "").trim().slice(0, 40);
          await tx.inventoryItem.update({
            where: { id: it.id },
            data: { majorCat: major, minorCat: minor },
          });
          updated++;
        }
      },
      { timeout: 30000 },
    );
  } catch (err) {
    console.error("[inventory] apply categories failed:", err);
    return { ok: false, error: "카테고리 적용에 실패했어요. 잠시 후 다시 시도해 주세요." };
  }
  await setInventoryPushPending(); // 다음 push 크론이 DB→시트(E/F열)에 반영
  await writeAudit({
    action: "inventory.categorize",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "inventory",
    targetId: "",
    summary: `재고 카테고리 적용: ${updated}개 품목`,
  });
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true, updated };
}

// 품목 1개의 카테고리 이동(수동 수정) — AI 자동분류가 틀린 건 여기서 옮긴다.
export async function setItemCategoryAction(
  itemId: string,
  major: string,
  minor: string,
): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();
  const id = String(itemId ?? "");
  if (!id) return { ok: false, error: "잘못된 요청이에요." };
  const majorCat = String(major ?? "").trim().slice(0, 40);
  const minorCat = String(minor ?? "").trim().slice(0, 40);
  const upd = await prisma.inventoryItem.updateMany({
    where: { id, deletedAt: null },
    data: { majorCat, minorCat },
  });
  if (upd.count === 0) return { ok: false, error: "품목을 찾을 수 없어요." };
  await setInventoryPushPending(); // 다음 push 크론이 시트 E/F열에 반영
  revalidatePath("/admin/inventory");
  revalidatePath("/inventory");
  return { ok: true };
}

// 구글시트 연동 점검 + 지금 강제로 시트 반영. 프로덕션 env/공유를 로컬에서 볼 수 없어,
// 관리자가 눌러 서버에서 진단하게 한다. 결과로 원인을 특정하고(자격증명 없음/인증실패/권한없음),
// 동시에 push 자체가 최신 재고+카테고리를 시트에 즉시 반영(자격증명이 정상이면 이 한 번으로 해결).
export type SheetSyncDiag = {
  configured: boolean; // GOOGLE_SERVICE_ACCOUNT_* 존재+파싱 성공
  clientEmail: string | null; // 이 이메일이 시트에 '편집자'로 공유돼 있어야 함
  sheetId: string;
  itemCount: number; // 시트에 올라갈 재고 수
  categorized: number; // 대분류가 붙은 재고 수(0이면 아직 분류 미적용)
  lastPushAt: string | null; // 마지막 성공 push 시각(없으면 한 번도 성공 못 함)
  pendingBefore: boolean; // 직전에 반영 대기 상태였는지
  push: { ok: boolean; error?: string }; // 방금 시도한 push 결과
  hint: string; // 사람이 읽을 진단 문구
};

export async function diagnoseSheetSyncAction(): Promise<SheetSyncDiag> {
  const admin = await requireAdmin();
  const sa = getServiceAccount();
  const configured = !!sa;
  const [itemCount, categorized, lastPush, pendingBefore] = await Promise.all([
    prisma.inventoryItem.count({ where: { deletedAt: null } }),
    prisma.inventoryItem.count({ where: { deletedAt: null, NOT: { majorCat: "" } } }),
    lastInventoryPushAt(),
    inventoryPushPending(),
  ]);
  // 실제 push 1회 — 진단이자 강제 반영. safePush가 pending 플래그도 정리.
  const push = configured
    ? await safePushInventory(2)
    : { ok: false, error: "no-credentials" };

  let hint: string;
  if (!configured) {
    hint =
      "서비스계정 자격증명(GOOGLE_SERVICE_ACCOUNT_B64)이 서버에 없습니다. Vercel 환경변수에 값이 비었거나 삭제됐어요. 값을 넣고 재배포하면 매 분 자동 반영됩니다.";
  } else if (push.ok) {
    hint =
      "정상입니다. 방금 최신 재고와 카테고리를 시트에 반영했어요. 이후에는 매 분 자동 반영됩니다.";
  } else if (push.error === "empty-db") {
    hint = "앱에 재고가 0건이라 시트를 보호하려 건너뛰었어요(비어있음).";
  } else if (push.error === "auth") {
    hint =
      "자격증명은 있으나 구글 토큰 발급에 실패했어요(개인키가 잘못됐거나 만료). 서비스계정 키를 다시 발급해 GOOGLE_SERVICE_ACCOUNT_B64를 갱신하세요.";
  } else if (String(push.error).includes("403") || String(push.error).includes("PERMISSION")) {
    hint = `시트 접근 권한이 없어요(403). 스프레드시트를 위 서비스계정 이메일(${sa?.client_email ?? ""})에 '편집자'로 공유했는지 확인하세요.`;
  } else {
    hint = `시트 반영에 실패했어요(${push.error ?? "알 수 없음"}). 시트ID·공유·네트워크를 확인하세요.`;
  }

  await writeAudit({
    action: "inventory.sheetDiagnose",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "inventory",
    targetId: "",
    summary: `시트 연동 점검: configured=${configured} push=${push.ok ? "ok" : push.error}`,
  });

  return {
    configured,
    clientEmail: sa?.client_email ?? null,
    sheetId:
      process.env.INVENTORY_SHEET_ID ||
      "1LlMirhN-ChqWKmzilH1_EX7yeDLK26SI-H61bvgGEG0",
    itemCount,
    categorized,
    lastPushAt: lastPush ? lastPush.toISOString() : null,
    pendingBefore,
    push,
    hint,
  };
}

// R4 재고 자동저장 — 편집기 입력을 디바운스로 계속 저장. 현재 목록으로 DB를 맞춘다(이름/수량/공급가
// 갱신 + 목록에서 빠진 항목 삭제). 시트 반영은 push하지 않고 'pending' 표시만 → 다음 크론이 반영(단방향).
export async function autosaveInventoryAction(payloadJson: string) {
  await requireAdmin();
  let rows: {
    id?: string;
    name?: string;
    qty?: unknown;
    supplyPrice?: unknown;
    expiry?: unknown; // #9 유통기한 "YY-MM-DD"/"YYYY-MM-DD" (정규화 후 저장)
    tax?: unknown; // 과세("TAXABLE")/면세("EXEMPT")/미선택("")
    baseQty?: unknown; // 편집기가 로드/직전저장 시점에 본 수량(변경 판별용)
  }[];
  try {
    rows = JSON.parse(String(payloadJson ?? "[]"));
  } catch {
    return; // 파싱 실패 시 아무것도 지우지 않음(전량 삭제 사고 방지)
  }
  if (!Array.isArray(rows)) return;

  const keepIds = rows.map((r) => String(r.id ?? "")).filter(Boolean);
  // 감사 #2/H2: 삭제가 발생할 때(현재 품목 수 > 남길 수)는 지우기 전에 자동 백업 → 실수로 날아가도 복구 가능.
  const currentCount = await prisma.inventoryItem.count({ where: { deletedAt: null } });
  if (currentCount > keepIds.length) {
    await snapshotInventory("자동 · 재고 삭제 전").catch(() => {});
  }
  await prisma.$transaction(async (tx) => {
    // 편집기에서 제거된(목록에 없는) 항목 삭제
    await tx.inventoryItem.deleteMany({
      where: { id: { notIn: keepIds.length ? keepIds : ["__none__"] } },
    });
    for (const r of rows) {
      const id = String(r.id ?? "");
      if (!id) continue;
      const name = String(r.name ?? "").trim();
      // ⚠️ 과다판매 방지: 자동저장은 편집기의 스냅샷이라, 관리자가 '안 건드린' 행의 qty를
      // 다시 써버리면 그 사이 점주 발주확정으로 차감된 base가 되살아난다.
      // → 관리자가 실제로 수량을 바꾼 행(baseQty와 다름)만 qty를 절대반영(=실사 정정 의도),
      //   안 바꾼 행은 qty를 건드리지 않아 동시 발주 차감을 보존한다.
      const qtyChanged = toInt(String(r.qty ?? "")) !== toInt(String(r.baseQty ?? r.qty ?? ""));
      // #9 유통기한: 빈값이면 삭제, 유효한 날짜면 정규화 저장, 입력 중 부분/오타면 기존값 유지
      // (자동저장이 타이핑 중간에 유효값을 지우지 않도록).
      const rawExp = String(r.expiry ?? "").trim();
      const normExp = normalizeExpiry(rawExp);
      const expiryUpdate =
        rawExp === "" ? { expiry: "" } : normExp ? { expiry: normExp } : {};
      // 과세/면세 — 관리자가 품목마다 하드코딩. supplyPrice처럼 항상 덮어씀(유효값만, 그 외 미선택).
      const taxRaw = String(r.tax ?? "");
      const tax = taxRaw === "TAXABLE" || taxRaw === "EXEMPT" ? taxRaw : "";
      await tx.inventoryItem.update({
        where: { id },
        data: {
          ...(name ? { name } : {}),
          ...(qtyChanged ? { qty: toInt(String(r.qty ?? "")) } : {}),
          supplyPrice: toInt(String(r.supplyPrice ?? "")),
          tax,
          ...expiryUpdate,
        },
      });
    }
  });
  await setInventoryPushPending(); // R3 변경 표시 → 다음 크론이 시트로 push
  // 자동저장은 편집기 상태가 이미 정확하므로 /admin/inventory 재검증 생략(편집 중 리셋 방지).
  revalidatePath("/inventory");
}

// #2 재고 백업/복구 — 위험작업(자동저장 삭제·붙여넣기) 전 자동백업 + 수동 백업/복구.
export async function backupInventoryAction(): Promise<{
  ok: boolean;
  count?: number;
  error?: string;
}> {
  await requireAdmin();
  try {
    const r = await snapshotInventory("수동 백업");
    revalidatePath("/admin/inventory");
    return { ok: true, count: r.count };
  } catch {
    return { ok: false, error: "백업에 실패했어요." };
  }
}

export async function listInventoryBackupsAction(): Promise<SnapshotMeta[]> {
  await requireAdmin();
  return listInventorySnapshots();
}

export async function restoreInventoryBackupAction(key: string): Promise<{
  ok: boolean;
  restored?: number;
  error?: string;
}> {
  const admin = await requireAdmin();
  const r = await restoreInventorySnapshot(String(key ?? ""));
  if (r.ok) {
    await setInventoryPushPending().catch(() => {});
    await writeAudit({
      action: "inventory.restore",
      actorId: admin.id,
      actorName: admin.storeName,
      summary: `재고 복구 · ${r.restored}품목`,
    }).catch(() => {});
    revalidatePath("/admin/inventory");
    revalidatePath("/inventory");
  }
  return r;
}

// #22 관리자 수동 '지금 시트로 내보내기' — DB 전체를 시트에 다시 쓴다(정합 복구용). 성공/실패 반환.
export type PushInvState = { ok?: boolean; error?: string; at?: number };
export async function pushInventoryToSheetAction(
  _prev: PushInvState,
  _formData: FormData,
): Promise<PushInvState> {
  await requireAdmin();
  const r = await safePushInventory();
  revalidatePath("/admin/inventory");
  if (r.ok) return { ok: true, at: Date.now() };
  if (r.error === "no-credentials")
    return { ok: false, error: "구글 서비스계정이 설정되지 않았어요." };
  return { ok: false, error: "시트 반영에 실패했어요. 잠시 후 다시 시도해 주세요." };
}

// 전체 발주 초기화 — 관리자 전용. 모든 Order 삭제(OrderItem은 Cascade).
// 회원·재고는 유지. 실수 방지를 위해 확인 토큰 필요.
export async function resetAllOrdersAction(formData: FormData) {
  const admin = await requireAdmin();
  if (String(formData.get("confirm") ?? "") !== "RESET-ALL-ORDERS") return;
  const res = await prisma.order.deleteMany({});
  await writeAudit({
    action: "orders.resetAll",
    actorId: admin.id,
    actorName: admin.storeName,
    targetType: "order",
    summary: `발주 전체 초기화 · ${res.count}건 삭제`,
  });
  revalidatePath("/admin");
  revalidatePath("/admin/orders");
  revalidatePath("/admin/hotdeal");
  redirect(`/admin/orders?reset=${res.count}`);
}

// 지점 발주 전체 취소 — 관리자 전용. 해당 점주가 그 날짜에 넣은 발주(전 카테고리)를 CANCELLED로.
// 하드삭제가 아니라 status=CANCELLED로 남겨 양쪽에 '취소 완료'로 보이고, 잠겼던 발주창은 다시 열림.
// 계산서(미수)가 발행됐으면 취소 불가(먼저 VOID). 점주에게 '관리자에 의해 발주가 취소되었습니다' 푸시.
// useActionState로 결과를 반환(리다이렉트 X) — 모달이 결과를 받아 스스로 닫히게(재로딩 방지).
export type CancelOrdersState = { ok?: boolean; count?: number; error?: string };

export async function cancelStoreOrdersAction(
  _prev: CancelOrdersState,
  formData: FormData,
): Promise<CancelOrdersState> {
  const admin = await requireAdmin();
  if (String(formData.get("confirm") ?? "") !== "CANCEL-STORE-ORDERS") return {};
  const userId = String(formData.get("userId") ?? "");
  const date = String(formData.get("date") ?? "");
  if (!userId || !date) return {};

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!target) return {};

  // 취소 범위: 가맹점(발주창 있음)은 '발주창 단위'로 지운다. 주말 연속창(토12시~일20시)은
  // KST 두 날짜에 걸쳐도 한 발주라 한 번에 취소(옛 버그#13: 하루만 지워 반쪽이 남아 채움채로 나감).
  // 소매·벤더(창 없음)는 종전대로 그 날짜 하루만.
  let start: Date;
  let end: Date;
  if (hasOrderWindow(target.role as Role)) {
    const noonMs = new Date(`${date}T12:00:00+09:00`).getTime();
    start = new Date(currentWindowStartUtc(noonMs));
    end = new Date(currentDeadlineUtc(noonMs));
  } else {
    ({ start, end } = kstDayRange(date));
  }
  // 취소 대상(아직 취소되지 않은 이 창의 발주)
  const targets = await prisma.order.findMany({
    where: { userId, createdAt: { gte: start, lt: end }, status: { not: "CANCELLED" } },
    select: { id: true, createdAt: true },
  });
  // 계산서(미수)가 발행됐으면 취소 불가 — 먼저 계산서 VOID 필요.
  // Invoice.date = '출고일' 기준이라 발주의 출고일(shipmentDayOf)로 매칭(발주일로 찾으면 하루 어긋남).
  const invDates = [...new Set(targets.map((o) => shipmentDayOf(kstDateOf(o.createdAt))))];
  if (invDates.length > 0) {
    const inv = await prisma.invoice.findFirst({
      where: { userId, kind: "DAILY", date: { in: invDates }, status: { in: ["ISSUED", "PAID"] } },
      select: { id: true },
    });
    if (inv) {
      return { error: "계산서가 발행되어 취소할 수 없어요. 먼저 계산서를 취소하세요." };
    }
    // 작성중(DRAFT) 계산서는 발행을 막지 않지만, 발주가 삭제되면 그 초안이 '삭제된 발주' 기준으로
    // 남아 나중에 잘못 발행될 수 있다 → 해당 날짜의 DRAFT 계산서를 함께 VOID 처리한다.
    await prisma.invoice.updateMany({
      where: { userId, kind: "DAILY", date: { in: invDates }, status: "DRAFT" },
      data: { status: "VOID", voidedAt: new Date() },
    });
  }
  // 취소되는 발주가 확정했던 공구(TOOL) 재고를 기준재고에 되돌린다(이름 매칭). 삭제 전에 수행해야
  // 항목이 남아있다(점주 발주취소 경로와 동일한 복구 — 지점취소만 빠져 있어 재고가 과소계상되던 버그).
  for (const o of targets) {
    await restoreStockForOrder(o.id).catch(() => {});
  }
  // #2 하드삭제 — 취소한 발주는 완전 삭제(취소 완료로 남기지 않고 모든 목록·내역에서 제거).
  const res = await prisma.order.deleteMany({
    where: { id: { in: targets.map((o) => o.id) } },
  });
  if (res.count > 0) {
    await writeAudit({
      action: "orders.cancelStore",
      actorId: admin.id,
      actorName: admin.storeName,
      targetType: "store",
      targetId: userId,
      summary: `지점 발주 삭제(취소) · ${date} · ${res.count}건`,
      snapshot: JSON.stringify({ orderIds: targets.map((o) => o.id), date }),
    });
    await notifyMerchantOrdersCancelled(userId);
  }

  revalidatePath("/admin/hotdeal");
  revalidatePath("/admin/orders");
  revalidatePath("/admin");
  revalidatePath(`/admin/combined/${userId}/${date}`);
  revalidatePath("/order");
  revalidatePath(`/order/day/${date}`);
  revalidatePath("/mypage");
  revalidatePath("/vendor");
  return { ok: true, count: res.count };
}
