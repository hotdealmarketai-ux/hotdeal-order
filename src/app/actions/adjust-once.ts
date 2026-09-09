"use server";

// [임시·1회용] 재고 임의 차감 실행 — 변경 기록(InventoryChangeLog)·감사 로그(AuditLog) 남기지 않음.
// 클릭 시점의 실재고 기준으로 상대 차감(decrement)하여 동시성에도 안전. 사용 후 제거.
import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/session";
import { setInventoryPushPending } from "@/lib/inventory-sheet";
import { resolveAdjustOnce } from "@/lib/adjust-once";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function applyAdjustOnceAction(formData: FormData) {
  await requireAdmin();
  if (String(formData.get("confirm")) !== "APPLY") return;

  const resolved = await resolveAdjustOnce();
  // 하나라도 못 찾음/모호/음수면 전량 중단(부분 적용 방지).
  if (!resolved.every((r) => r.status === "ok")) return;

  await prisma.$transaction(
    resolved.map((r) =>
      prisma.inventoryItem.update({
        where: { id: r.itemId! },
        data: { qty: { decrement: r.target.deduct } }, // 수량만 상대 차감, 로그 없음
      }),
    ),
  );

  await setInventoryPushPending(); // 시트 값 일관성(기록 아님)
  revalidatePath("/admin/inventory");
  redirect("/admin/adjust-once?done=1");
}
