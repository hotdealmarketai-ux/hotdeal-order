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
import {
  allowedCategoriesFor,
  needsFulfillment,
  needsPickupTime,
} from "@/lib/constants";
import {
  hasOrderWindow,
  isOrderOpen,
  currentWindowStartUtc,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { kstDateOf, kstToday, shiftDate, labelDate } from "@/lib/date";
import { orderLockOf, receivableOf } from "@/lib/receivable";
import { orderOpenNow } from "@/lib/order-open";
import { getReservationLoadForOrder } from "@/lib/reservation-data";
import { myHolds, heldByItem } from "@/lib/stock-hold";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { RequestCancelButton } from "@/components/RequestCancelButton";

export default async function OrderPage(props: {
  searchParams: Promise<{ cancelReq?: string; cancelErr?: string }>;
}) {
  const { cancelReq, cancelErr } = await props.searchParams;
  const user = await requireMerchant();
  const windowed = hasOrderWindow(user.role);
  const open = await orderOpenNow(user.role); // 운영시간 또는 관리자 임시 오픈

  // 1일 미수 잠금 — 지난 날짜 미입금 계산서가 있으면 발주 잠금(관리자 해제 시 예외)
  const receivableLock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  // 현재 미수 요약(발행·미입금 계산서 전체) — 발주 화면 상단 카드로 노출
  const receivable = await receivableOf(user.id);

  // 가맹점: 이번 발주 창에 이미 넣은 발주가 있으면 새 발주는 잠그고 수정만.
  // 취소(CANCELLED)된 발주는 제외 → 취소되면 발주창이 자동으로 다시 열린다.
  let existingOrderDate: string | null = null;
  let cancelPending = false;
  if (windowed && open) {
    const since = new Date(currentWindowStartUtc());
    const existing = await prisma.order.findFirst({
      where: {
        userId: user.id,
        createdAt: { gte: since },
        status: { not: "CANCELLED" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, cancelRequested: true },
    });
    if (existing) {
      existingOrderDate = kstDateOf(existing.createdAt);
      cancelPending = existing.cancelRequested;
    }
  }
  const lockedToEdit = !!existingOrderDate;

  // 공구 자동로드 — 오늘이 '픽업 전날'인 확정 예약분(읽기전용, 단일출처). 핫딜마켓만.
  const orderDay = kstToday();
  const reservedTool =
    user.role === "MERCHANT_HOTDEAL"
      ? await getReservationLoadForOrder(user.id, orderDay)
      : [];
  const reservedLabel =
    reservedTool.length > 0 ? `픽업 ${labelDate(shiftDate(orderDay, 1))} 예약분` : "";

  // 공구 담기 = 서버 담기원장(오늘 발주창). 발주 화면에서 바로 +/- 하도록 남은수량·공급가까지 실어보낸다.
  // 남은수량(available) = 기준재고 − 전체 담기(내 것 포함). 실시간 공유 = 모든 가맹점이 같은 값을 본다.
  const toolCart =
    user.role === "MERCHANT_HOTDEAL"
      ? await (async () => {
          const [mine, held, invItems] = await Promise.all([
            myHolds(user.id, orderDay),
            heldByItem(orderDay),
            prisma.inventoryItem.findMany({
              where: { deletedAt: null },
              select: { id: true, qty: true, supplyPrice: true },
            }),
          ]);
          const invById = new Map(invItems.map((i) => [i.id, i]));
          return mine.map((h) => {
            const inv = invById.get(h.itemId);
            const base = inv?.qty ?? 0;
            return {
              itemId: h.itemId,
              name: h.name,
              qty: String(h.qty),
              mine: h.qty,
              available: Math.max(0, base - (held[h.itemId] ?? 0)),
              supplyPrice: inv?.supplyPrice ?? 0,
            };
          });
        })()
      : [];

  return (
    <>
      <Topbar
        brand="핫딜오더"
        right={<TopbarChip>{user.storeName}</TopbarChip>}
      >
        {windowed && <DeadlineCountdown deadlineLabel={ORDER_DEADLINE_LABEL} />}
      </Topbar>
      <div className="page">
        {receivable.balance > 0 && (
          <Link
            href="/invoices"
            className="card"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              marginBottom: 16,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span style={{ color: "var(--muted)" }}>
              현재 미수 · {receivable.count}건
            </span>
            <span style={{ fontWeight: 800, fontSize: 15, color: "var(--danger)" }}>
              {receivable.balance.toLocaleString("ko-KR")}원 ›
            </span>
          </Link>
        )}
        {cancelReq === "1" && (
          <div className="notice notice--ok" style={{ marginBottom: 16 }}>
            발주 취소 요청이 접수되었어요. 관리자 승인 후 취소가 완료됩니다.
          </div>
        )}
        {cancelErr === "invoiced" && (
          <div className="notice notice--error" style={{ marginBottom: 16 }}>
            계산서가 이미 발행되어 취소 요청을 할 수 없습니다.
          </div>
        )}
        {receivableLock.locked ? (
          <>
            <h1 className="h1">발주하기</h1>
            <div className="notice notice--error" style={{ marginBottom: 16 }}>
              <b>지난 발주가 결제되지 않았습니다. 미수금 결제 부탁드립니다.</b>
              <br />
              {receivableLock.unpaidDate
                ? `${labelDate(receivableLock.unpaidDate)} 입금요청서 ${receivableLock.unpaidTotal.toLocaleString("ko-KR")}원`
                : ""}{" "}
              입금이 확인되면 발주가 다시 활성화 됩니다.
            </div>
            <Link href="/invoices" className="btn btn--primary">
              입금요청서 보기
            </Link>
          </>
        ) : lockedToEdit ? (
          <>
            <h1 className="h1">발주하기</h1>
            {cancelPending ? (
              <div className="notice notice--edit" style={{ marginBottom: 16 }}>
                <b>취소 요청됨</b> · 관리자 승인 대기중이에요. 승인되면 발주가
                취소되고 발주창이 다시 활성화 됩니다.
              </div>
            ) : (
              <div className="notice notice--mute" style={{ marginBottom: 16 }}>
                이미 주문이 진행됐으므로, 발주 수정만 가능합니다.
              </div>
            )}
            <Link
              href={`/order/day/${existingOrderDate}`}
              className="btn btn--primary"
            >
              발주 수정하러 가기
            </Link>
            {!cancelPending && (
              <div style={{ marginTop: 12 }}>
                <RequestCancelButton />
              </div>
            )}
          </>
        ) : (
          <OrderForm
            categories={allowedCategoriesFor(user.role)}
            needsPickup={needsPickupTime(user.role)}
            needsFulfillment={needsFulfillment(user.role)}
            address={user.address ?? ""}
            locked={windowed && !open}
            role={user.role}
            reservedTool={reservedTool}
            reservedLabel={reservedLabel}
            toolCart={toolCart}
          />
        )}
      </div>
    </>
  );
}
