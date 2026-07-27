// #6 발주 추가 — 이미 넣은 발주는 그대로 두고, 빠뜨린 종류(예: 채움채)만 새로 발주.
// createOrderAction이 '이미 넣은 카테고리'만 거부하므로, 여기선 아직 안 넣은 카테고리만 폼에 노출.
// 공구(TOOL)는 담기(재고현황) 기반이라 이 화면에서 제외 — 자유입력 카테고리(과일/야채/채움채)만.
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  allowedCategoriesFor,
  needsFulfillment,
  needsPickupTime,
} from "@/lib/constants";
import { hasOrderWindow, currentWindowStartUtc } from "@/lib/deadline";
import { orderOpenNow } from "@/lib/order-open";
import { kstDayRange, kstToday } from "@/lib/date";
import { orderLockOf } from "@/lib/receivable";
import { windowKeyAt } from "@/lib/schedule";
import { OrderForm } from "@/components/OrderForm";

export default async function AddOrderPage() {
  const user = await requireMerchant();
  // 발주창 있는 가맹점만(소매/벤더는 자유 발주라 '추가' 개념 없음)
  if (!hasOrderWindow(user.role)) redirect("/order");
  // 발주 시간(또는 임시 오픈) 아니면 메인으로
  if (!(await orderOpenNow(user.role))) redirect("/order");
  // 미수 잠금이면 메인으로(메인에서 안내)
  const lock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  if (lock.locked) redirect("/order");

  // 이번 발주창에 이미 넣은 카테고리 — createOrderAction과 동일 기준(창시작/오늘0시 중 이른쪽).
  const since = new Date(
    Math.min(currentWindowStartUtc(), kstDayRange(kstToday()).start.getTime()),
  );
  const existing = await prisma.order.findMany({
    where: { userId: user.id, createdAt: { gte: since }, status: { not: "CANCELLED" } },
    select: { category: true },
  });
  const orderedCats = new Set(existing.map((o) => o.category));

  // 추가 가능 = 허용 카테고리 − 이미 넣음 − 공구(담기 기반). 없으면 메인 발주서로.
  const missing = allowedCategoriesFor(user.role).filter(
    (c) => !orderedCats.has(c) && c !== "TOOL",
  );
  if (missing.length === 0) redirect(`/order/day/${kstToday()}`);

  return (
    <>
      <Topbar
        backHref="/order"
        title="발주 추가"
        right={<TopbarChip>{user.storeName}</TopbarChip>}
      />
      <div className="page">
        <div className="notice notice--mute" style={{ marginBottom: 16 }}>
          이미 넣은 발주는 그대로 두고, 빠뜨린 종류만 추가로 발주해요.
        </div>
        <OrderForm
          categories={missing}
          needsPickup={needsPickupTime(user.role)}
          needsFulfillment={needsFulfillment(user.role)}
          address={user.address ?? ""}
          role={user.role}
          windowKey={`${windowKeyAt()}-add`}
        />
      </div>
    </>
  );
}
