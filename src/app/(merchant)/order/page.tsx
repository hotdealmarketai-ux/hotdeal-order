// ============================================================
//  OrderPage — 코발트 교체본
//  위치: src/app/(merchant)/order/page.tsx 교체
//  변경: ② PushToggle 을 본문 맨 위 → OrderForm "아래"로 이동
//  나머지(미수 잠금·발주창 잠금·기존발주 수정 유도 분기)는 기존 그대로
// ============================================================

import Link from "next/link";
import { redirect } from "next/navigation";
import { Topbar, TopbarChip } from "@/components/Topbar";
import { requireMerchant } from "@/lib/session";
import { needsOnboarding } from "@/lib/onboarding";
import { prisma } from "@/lib/prisma";
import {
  allowedCategoriesFor,
  needsFulfillment,
  needsPickupTime,
} from "@/lib/constants";
import {
  hasOrderWindow,
  currentWindowStartUtc,
  ORDER_DEADLINE_LABEL,
} from "@/lib/deadline";
import { kstDateOf, kstToday, kstDayRange, shiftDate, labelDate } from "@/lib/date";
import { orderLockOf, receivableOf } from "@/lib/receivable";
import { orderOpenNow } from "@/lib/order-open";
import {
  orderChannelConfig,
  effectiveChannels,
  fixedItemsByCat,
} from "@/lib/order-flags";
import { getReservationLoadForOrder } from "@/lib/reservation-data";
import { windowKeyAt } from "@/lib/schedule";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { RequestCancelButton } from "@/components/RequestCancelButton";

export default async function OrderPage(props: {
  searchParams: Promise<{ cancelReq?: string; cancelErr?: string }>;
}) {
  const { cancelReq, cancelErr } = await props.searchParams;
  const user = await requireMerchant();
  // 가맹 오픈 온보딩 중이면 발주 대신 '오픈 준비' 퀘스트로.
  if (needsOnboarding(user)) redirect("/onboarding");
  const windowed = hasOrderWindow(user.role);
  const open = await orderOpenNow(user.role); // 운영시간 또는 관리자 임시 오픈

  // 일반 발주 관리 — 발주 방식(칸/채팅) 잠금 + 과일/야채 품목 고정
  const channelCfg = await orderChannelConfig();
  const { gridDisabled, chatDisabled } = effectiveChannels(channelCfg);
  const fixedItems =
    channelCfg.fixedFruit || channelCfg.fixedVeg
      ? await fixedItemsByCat(true)
      : { FRUIT: [], VEG: [] };

  // 1일 미수 잠금 — 지난 날짜 미입금 계산서가 있으면 발주 잠금(관리자 해제 시 예외)
  const receivableLock = await orderLockOf(user.id, user.orderUnlock, user.orderUnlockAt);
  // 현재 미수 요약(지점 총미수) — 발주 화면 상단 카드로 노출
  const receivable = await receivableOf(user.id);

  // 가맹점: 이번 발주 창에 이미 넣은 발주가 있으면 새 발주는 잠그고 수정만.
  // 취소(CANCELLED)된 발주는 제외 → 취소되면 발주창이 자동으로 다시 열린다.
  let existingOrderDate: string | null = null;
  let cancelPending = false;
  if (windowed && open) {
    // 서버(createOrderAction)와 동일 기준 — 강제오픈으로 정오 이전에 넣은 발주도 잡아
    // '수정 모드'로 전환되게 한다(둘이 어긋나면 화면은 새 발주, 서버는 거부로 혼란).
    const since = new Date(
      Math.min(currentWindowStartUtc(), kstDayRange(kstToday()).start.getTime()),
    );
    const existing = await prisma.order.findMany({
      where: {
        userId: user.id,
        createdAt: { gte: since },
        status: { not: "CANCELLED" },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, cancelRequested: true },
    });
    if (existing.length > 0) {
      existingOrderDate = kstDateOf(existing[0].createdAt);
      cancelPending = existing[0].cancelRequested;
    }
  }
  const lockedToEdit = !!existingOrderDate;
  // 빠뜨린 종류는 '발주 수정'(통합)에서 추가 — 별도 '발주 추가' 화면 폐지(#6 대체).

  // 공구 자동로드 — 오늘이 '픽업 전날'인 확정 예약분(읽기전용, 단일출처). 핫딜마켓만.
  const orderDay = kstToday();
  const reservedTool =
    user.role === "MERCHANT_HOTDEAL"
      ? await getReservationLoadForOrder(user.id, orderDay)
      : [];
  const reservedLabel =
    reservedTool.length > 0 ? `픽업 ${labelDate(shiftDate(orderDay, 1))} 예약분` : "";

  // 공구(TOOL)는 예약발주 단일 소스로 전환 — 재고현황 담기 폐지.
  // 발주 화면 공구칸엔 예약분(reservedTool)만 읽기전용으로 노출하므로 담기(toolCart)는 항상 빈 배열.

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
              미수 {receivableLock.unpaidTotal.toLocaleString("ko-KR")}원 (지점 전체) 입금이
              확인되면 발주가 다시 활성화 됩니다.
            </div>
            <Link href="/invoices" className="btn btn--primary">
              입금요청서 보기
            </Link>
          </>
        ) : lockedToEdit ? (
          <>
            <h1 className="h1" style={{ marginBottom: 24 }}>
              발주하기
            </h1>
            {cancelPending && (
              <div className="notice notice--edit" style={{ marginBottom: 16 }}>
                <b>취소 요청됨</b> · 관리자 승인 대기중이에요. 승인되면 발주가
                취소되고 발주창이 다시 활성화 됩니다.
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
            toolCart={[]}
            windowKey={windowKeyAt()}
            gridDisabled={gridDisabled}
            chatDisabled={chatDisabled}
            fixedFruit={channelCfg.fixedFruit}
            fixedVeg={channelCfg.fixedVeg}
            fixedItems={fixedItems}
          />
        )}
      </div>
    </>
  );
}
