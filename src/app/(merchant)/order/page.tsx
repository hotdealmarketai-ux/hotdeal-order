import Link from "next/link";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { allowedCategoriesFor, needsPickupTime } from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { kstDateOf } from "@/lib/date";
import { buildTypicals } from "@/lib/unit";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { PushToggle } from "@/components/PushToggle";

export default async function OrderPage() {
  const user = await requireMerchant();
  const windowed = hasOrderWindow(user.role);
  const open = !windowed || isOrderOpen();

  // 가맹점: 이번 발주 창에 이미 넣은 발주가 있으면 새 발주는 잠그고 수정만
  let existingOrderDate: string | null = null;
  if (windowed && open) {
    const since = new Date(currentWindowStartUtc());
    const existing = await prisma.order.findFirst({
      where: { userId: user.id, createdAt: { gte: since } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    if (existing) existingOrderDate = kstDateOf(existing.createdAt);
  }
  const lockedToEdit = !!existingOrderDate;

  // 이상 수량 경고용: 과거 발주 품목별 '평소 수량'(중앙값)
  const pastItems = await prisma.orderItem.findMany({
    where: { order: { userId: user.id } },
    select: { name: true, rawName: true, rawQty: true, qty: true },
    orderBy: { order: { createdAt: "desc" } },
    take: 500,
  });
  const typicals = buildTypicals(pastItems);

  return (
    <>
      <header className="topbar">
        <div className="brandmark">오더야</div>
        <div className="topbar__spacer" />
        <span className="chip">{user.storeName}</span>
      </header>
      <div className="page">
        {windowed && <DeadlineCountdown deadlineLabel={ORDER_DEADLINE_LABEL} />}

        <PushToggle />

        {lockedToEdit ? (
          <>
            <h1 className="h1">발주하기</h1>
            <div className="notice notice--mute" style={{ marginBottom: 16 }}>
              이미 주문이 진행됐으므로, 발주수정만 가능합니다.
            </div>
            <Link
              href={`/order/day/${existingOrderDate}`}
              className="btn btn--primary"
            >
              발주 수정하러 가기
            </Link>
          </>
        ) : (
          <OrderForm
            categories={allowedCategoriesFor(user.role)}
            needsPickup={needsPickupTime(user.role)}
            locked={windowed && !open}
            role={user.role}
            typicals={typicals}
          />
        )}
      </div>
    </>
  );
}
