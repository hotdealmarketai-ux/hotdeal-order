// ============================================================
//  OrderPage — 코발트 교체본
//  위치: src/app/(merchant)/order/page.tsx 교체
//  변경: ② PushToggle 을 본문 맨 위 → OrderForm "아래"로 이동
//  나머지(미수 잠금·발주창 잠금·기존발주 수정 유도 분기)는 기존 그대로
// ============================================================

import Link from "next/link";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { allowedCategoriesFor, needsPickupTime } from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { kstDateOf, labelDate } from "@/lib/date";
import { orderLockOf } from "@/lib/receivable";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { PushToggle } from "@/components/PushToggle";

export default async function OrderPage() {
  const user = await requireMerchant();
  const windowed = hasOrderWindow(user.role);
  const open = !windowed || isOrderOpen();

  // 1일 미수 잠금 — 지난 날짜 미입금 계산서가 있으면 발주 잠금(관리자 해제 시 예외)
  const receivableLock = await orderLockOf(user.id, user.orderUnlock);

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

  return (
    <>
      <Topbar
        brand="핫딜오더"
        right={
          <>
            <TopbarChip>{user.storeName}</TopbarChip>
            <PushToggle variant="header" />
          </>
        }
      >
        {windowed && <DeadlineCountdown deadlineLabel={ORDER_DEADLINE_LABEL} />}
      </Topbar>
      <div className="page">
        {receivableLock.locked ? (
          <>
            <h1 className="h1">발주하기</h1>
            <div className="notice notice--error" style={{ marginBottom: 16 }}>
              <b>지난 발주가 결제되지 않았습니다.</b>
              <br />
              {receivableLock.unpaidDate
                ? `${labelDate(receivableLock.unpaidDate)} 입금요청서 ${receivableLock.unpaidTotal.toLocaleString("ko-KR")}원`
                : ""}{" "}
              입금이 확인되면 발주가 다시 열려요. (급하면 새롭에 문의)
            </div>
            {receivableLock.unpaidDate && (
              <Link
                href={`/order/day/${receivableLock.unpaidDate}?view=invoice`}
                className="btn btn--primary"
              >
                입금요청서 보기
              </Link>
            )}
          </>
        ) : lockedToEdit ? (
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
          />
        )}
      </div>
    </>
  );
}
