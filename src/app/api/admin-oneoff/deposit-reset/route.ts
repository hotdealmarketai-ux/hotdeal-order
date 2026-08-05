// [임시 1회성 · 2026-08-05] 입출금내역 초기화 + 매칭으로 차감된 미수 원복. 관리자 세션 전용.
// GET            = inspect(dry-run): 무엇을 지우고 얼마를 되돌릴지 리포트만.
// GET ?confirm=DEPOSIT-RESET-2026-08-05 = commit: 매칭조정 삭제(미수 복원) + 입금 전부 소프트삭제.
// 작업 후 이 파일 삭제 예정.
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/session";
import { prisma } from "@/lib/prisma";

export const maxDuration = 60;
const won = (n: number) => n.toLocaleString("ko-KR");

export async function GET(request: Request) {
  await requireAdmin(); // 관리자 세션만 접근 가능
  const commit =
    new URL(request.url).searchParams.get("confirm") === "DEPOSIT-RESET-2026-08-05";

  // 지울 대상: 삭제분 제외한 모든 입금(매칭+미매칭)
  const deposits = await prisma.deposit.findMany({
    where: { matchStatus: { not: "DELETED" } },
    select: { matchStatus: true, appliedInvoiceId: true },
  });
  const byStatus: Record<string, number> = {};
  let appliedInvoiceCount = 0;
  for (const d of deposits) {
    byStatus[d.matchStatus] = (byStatus[d.matchStatus] ?? 0) + 1;
    if (d.appliedInvoiceId) appliedInvoiceCount += 1;
  }

  // 매칭으로 만든 미수조정(depositId 링크) — 삭제하면 그 지점 미수가 그만큼 복원(조정 amount는 음수).
  const adjs = await prisma.receivableAdjustment.findMany({
    where: { depositId: { not: null } },
    select: { userId: true, amount: true },
  });
  const restoreByUser = new Map<string, number>();
  for (const a of adjs)
    restoreByUser.set(a.userId, (restoreByUser.get(a.userId) ?? 0) + -a.amount);
  const users = await prisma.user.findMany({
    where: { id: { in: [...restoreByUser.keys()] } },
    select: { id: true, storeName: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.storeName]));
  const restore = [...restoreByUser.entries()]
    .map(([id, amt]) => ({ store: nameById.get(id) ?? id, restored: amt, restoredLabel: won(amt) + "원" }))
    .sort((a, b) => b.restored - a.restored);
  const restoreTotal = restore.reduce((n, r) => n + r.restored, 0);

  const summary = {
    deposits_to_delete: deposits.length,
    by_status: byStatus,
    matching_adjustments_to_remove: adjs.length,
    restore_store_count: restore.length,
    restore_total: restoreTotal,
    restore_total_label: won(restoreTotal) + "원",
    restore_detail: restore,
    legacy_appliedInvoice_deposits: appliedInvoiceCount,
    legacy_note:
      "예전 '입금확인'으로 계산서를 결제완료(PAID)로 만든 건은 건드리지 않음(계산서 상태 유지). 오늘 '매칭'으로 미수를 깎은 것(조정)만 복원.",
  };

  if (!commit) {
    return NextResponse.json({ mode: "INSPECT (dry-run, 변경 없음)", ...summary });
  }

  // ── COMMIT ──
  const delAdj = await prisma.receivableAdjustment.deleteMany({
    where: { depositId: { not: null } },
  });
  const delDep = await prisma.deposit.updateMany({
    where: { matchStatus: { not: "DELETED" } },
    data: { matchStatus: "DELETED", matchedUserId: null, matchedAt: null },
  });
  return NextResponse.json({
    mode: "COMMITTED (실행 완료)",
    adjustments_deleted: delAdj.count,
    deposits_soft_deleted: delDep.count,
    ...summary,
  });
}
