"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/session";
import { writeAudit } from "@/lib/audit";
import { setOrderFlag, type OrderFlagKey } from "@/lib/order-flags";

type Res = { ok?: boolean; error?: string };

function revalidateAll() {
  revalidatePath("/admin/order-plan");
  revalidatePath("/order");
}

// 발주 시스템 관리 화면에서 바꿀 수 있는 스위치 — 발주 방식(칸·채팅)만.
// 옛 '품목 고정'(fixedFruit/fixedVeg)은 품목 제한 모드와 겹쳐 화면을 없앴고, 다시 켜지지 않게 여기서도 받지 않는다.
const FLAG_LABEL: Partial<Record<OrderFlagKey, string>> = {
  gridOff: "칸 발주 잠금",
  chatOff: "채팅 발주 잠금",
};

/** 발주 방식 스위치 토글. */
export async function setOrderModeFlagAction(fd: FormData): Promise<Res> {
  const admin = await requireAdmin();
  const key = String(fd.get("key") ?? "") as OrderFlagKey;
  const label = FLAG_LABEL[key];
  if (!label) return { error: "잘못된 요청이에요." };
  const on = String(fd.get("on") ?? "") === "true";
  await setOrderFlag(key, on);
  await writeAudit({
    action: "orderConfig.flag",
    actorId: admin.id,
    actorName: admin.storeName,
    summary: `${label} ${on ? "ON" : "OFF"}`,
  }).catch(() => {});
  revalidateAll();
  return { ok: true };
}
