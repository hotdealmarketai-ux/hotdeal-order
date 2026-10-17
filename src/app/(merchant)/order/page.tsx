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
import { hasOrderWindow, ORDER_DEADLINE_LABEL } from "@/lib/deadline";
import { kstDateOf, labelDate, labelShipment, shipmentDayOf } from "@/lib/date";
import { orderLockOf, receivableOf } from "@/lib/receivable";
import { orderTimeOpenForUser } from "@/lib/receivable";
import {
  orderChannelConfig,
  effectiveChannels,
  fixedItemsByCat,
} from "@/lib/order-flags";
import { getReservationLoadForShipment } from "@/lib/reservation-data";
import { myHolds, heldByItem } from "@/lib/stock-hold";
import { windowKeyAt } from "@/lib/schedule";
import { OrderForm } from "@/components/OrderForm";
import { DeadlineCountdown } from "@/components/DeadlineCountdown";
import { RequestCancelButton } from "@/components/RequestCancelButton";
import { merchantVisibility, modeStamp } from "@/lib/restrict-mode";
import { merchantPlanView, windowOrdersWhere } from "@/lib/order-plan";
import { logError } from "@/lib/log";
import { restrictedCategories, toPlanFormView } from "./plan-view";
import { ShipGoodsCard } from "./ShipGoodsCard";
import "./order-plan-form.css";

export default async function OrderPage(props: {
  searchParams: Promise<{ cancelReq?: string; cancelErr?: string; n?: string }>;
}) {
  const { cancelReq, cancelErr, n: navNote } = await props.searchParams;
  const user = await requireMerchant();
  // 가맹 오픈 온보딩 중이면 발주 대신 '오픈 준비' 퀘스트로.
  if (needsOnboarding(user)) redirect("/onboarding");
  const windowed = hasOrderWindow(user.role);
  const open = await orderTimeOpenForUser(user); // 운영시간·강제오픈 또는 이 지점 '시간 1회 열기'

  // 품목 제한 모드 — 켜져 있으면 오늘(발주창) 편성 품목만. 재고 담기·재고 검색·채팅은 쓰지 않는다.
  const vis = await merchantVisibility(user);
  const restricted = vis.restricted;
  const planKey = windowKeyAt();

  // 발주 방식 설정 — 발주 방식(칸/채팅) 잠금 + 과일/야채 품목 고정
  const channelCfg = await orderChannelConfig();
  const { gridDisabled, chatDisabled } = effectiveChannels(channelCfg, restricted);
  const fixedItems =
    !restricted && (channelCfg.fixedFruit || channelCfg.fixedVeg)
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
    // 서버(createOrderAction·중복 종류 검사)와 동일 기준 = 발주창 키 묶음(windowOrdersWhere) —
    // 주말 토·일, 강제오픈·시간 열기로 정오 전에 넣은 발주도 같은 창으로 잡아 '수정 모드'로 전환한다.
    const existing = await prisma.order.findMany({
      where: windowOrdersWhere(user.id, windowKeyAt()),
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

  // 함께 오는 공산품 — 이 발주창 출고일(토·일 발주는 월요일 출고분)의 확정 공산품(읽기전용, 단일출처). 핫딜마켓만.
  // 꺼짐 = 공구 탭 칩 / 켜짐 = 종류 탭 위 카드 / 발주 뒤 = 수정 버튼 아래 카드. 날짜는 계산서·출고와 같은 출고일.
  const shipDay = shipmentDayOf(planKey);
  const reservedTool =
    user.role === "MERCHANT_HOTDEAL"
      ? await getReservationLoadForShipment(user.id, shipDay)
      : [];
  const reservedLabel = reservedTool.length > 0 ? labelShipment(shipDay) : "";
  const goodsHref = vis.reservations ? "/reservations" : "";

  // 공구 담기 = 서버 담기원장(오늘 발주창). 발주 화면에서 바로 +/- 하도록 남은수량·공급가까지 실어보낸다.
  // 남은수량(available) = 기준재고 − 전체 담기(내 것 포함). 실시간 공유 = 모든 가맹점이 같은 값을 본다.
  const toolCart =
    user.role === "MERCHANT_HOTDEAL" && !restricted
      ? await (async () => {
          const holdKey = windowKeyAt(); // 담기 창키(주말 연속창=토요일 하나). orderDay(캘린더)와 구분.
          const [mine, held, invItems] = await Promise.all([
            myHolds(user.id, holdKey),
            heldByItem(holdKey),
            prisma.inventoryItem.findMany({
              where: { deletedAt: null },
              select: {
                id: true,
                qty: true,
                supplyPrice: true,
                expiry: true,
                majorCat: true,
                minorCat: true,
              },
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
              expiry: inv?.expiry ?? "",
              majorCat: inv?.majorCat ?? "",
              minorCat: inv?.minorCat ?? "",
            };
          });
        })()
      : [];

  // 제한 모드 편성(점주 화면·실시간 조회가 같은 계산 merchantPlanView 를 쓴다)
  // 편성을 못 읽으면(일시 DB 오류) 페이지를 깨지 않고 폼이 '불러오지 못했어요' 띠 + 확정 잠금으로 처리한다.
  const rawPlan =
    restricted && !receivableLock.locked && !lockedToEdit
      ? await merchantPlanView(planKey, user.id).catch((err) => {
          logError("order.planView", err, { userId: user.id, planKey });
          return null;
        })
      : null;
  const planView = rawPlan ? toPlanFormView(rawPlan) : undefined;
  // 채움채 = 그날 보이는 품목만(편성이 없으면 4개 전부 — visibleTofuCatalog)
  const tofuList = rawPlan ? rawPlan.tofu.visible.map((p) => ({ seq: p.seq, name: p.name })) : undefined;

  return (
    <>
      <Topbar
        brand="핫딜오더"
        right={<TopbarChip>{user.storeName}</TopbarChip>}
      >
        {windowed && <DeadlineCountdown deadlineLabel={ORDER_DEADLINE_LABEL} />}
      </Topbar>
      <div className="page">
        {restricted && navNote === "restricted" && (
          <div className="notice notice--mute" style={{ marginBottom: 14 }}>
            재고현황은 지금 쉬고 있어요.
          </div>
        )}
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
            <div style={{ marginTop: 20 }}>
              <ShipGoodsCard shipLabel={labelDate(shipDay)} lines={reservedTool} href={goodsHref} />
            </div>
          </>
        ) : (
          <OrderForm
            categories={
              restricted ? restrictedCategories(allowedCategoriesFor(user.role)) : allowedCategoriesFor(user.role)
            }
            needsPickup={needsPickupTime(user.role)}
            needsFulfillment={needsFulfillment(user.role)}
            address={user.address ?? ""}
            locked={windowed && !open}
            role={user.role}
            reservedTool={reservedTool}
            reservedLabel={reservedLabel}
            toolCart={toolCart}
            windowKey={windowKeyAt()}
            gridDisabled={gridDisabled}
            chatDisabled={chatDisabled}
            fixedFruit={channelCfg.fixedFruit}
            fixedVeg={channelCfg.fixedVeg}
            fixedItems={fixedItems}
            restricted={restricted}
            planView={planView}
            restrictStamp={restricted ? modeStamp(true, planKey) : undefined}
            tofuList={tofuList}
            draftOwner={user.id}
            shipLabel={labelDate(shipDay)}
            goodsHref={goodsHref}
          />
        )}
      </div>
    </>
  );
}
