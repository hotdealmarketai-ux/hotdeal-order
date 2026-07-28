"use client";

import { useMemo, useState } from "react";
import {
  confirmReservationAction,
  unlockReservationAction,
} from "@/app/actions/reservation";
import { SubmitButton } from "./SubmitButton";
import { ReservationStockStepper } from "./ReservationStockStepper";
import { useLiveReservationStock } from "@/lib/useLiveReservationStock";
import type { ReservationProductRow } from "@/lib/reservation-data";
import { labelDate } from "@/lib/date";

const won = (n: number) => n.toLocaleString("ko-KR");

export function ReservationOrderForm({
  batchId,
  products,
  confirmed,
  qtyByProduct,
  closed,
  availableByProduct = {},
}: {
  batchId: string;
  products: ReservationProductRow[];
  confirmed: boolean;
  qtyByProduct: Record<string, number>;
  closed: boolean;
  availableByProduct?: Record<string, number>;
}) {
  // 연동(재고현황) 상품 = 실시간 담기 스테퍼 / 수기 상품 = 입력. '예약 확정'이 둘 다 잠근다.
  const linked = products.filter((p) => p.inventoryItemId);
  const manual = products.filter((p) => !p.inventoryItemId);

  const live = useLiveReservationStock(batchId);
  const locked = closed || confirmed; // 확정 or 마감 → 연동·수기 모두 잠금

  const [qty, setQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const p of manual) {
      const q = qtyByProduct[p.id] ?? 0;
      m[p.id] = q > 0 ? String(q) : "";
    }
    return m;
  });
  const toNum = (s: string) =>
    Math.max(0, Math.floor(Number(String(s).replace(/[^\d]/g, "")) || 0));
  const items = useMemo(
    () =>
      manual
        .map((p) => ({ productId: p.id, qty: toNum(qty[p.id] ?? "") }))
        .filter((i) => i.qty > 0),
    [manual, qty],
  );
  const manualTotal = items.reduce((s, i) => s + i.qty, 0);
  // 연동 담긴 수량(실시간 mine, 없으면 SSR). 확정 가능 여부 판단용.
  const linkedTotal = linked.reduce(
    (s, p) => s + live.mineOf(p.id, qtyByProduct[p.id] ?? 0),
    0,
  );
  const totalReserved = manualTotal + linkedTotal;

  return (
    <>
      {/* 재고현황 연동 상품 — 담는 즉시 예약(실시간 남은재고 안에서 −/+). 확정 시 잠김 */}
      {linked.length > 0 && (
        <>
          <div className={`resv-lock${closed ? " resv-lock--closed" : ""}`}>
            {closed
              ? "예약이 마감되었어요."
              : confirmed
                ? "예약이 확정되어 잠겼어요. 수정하려면 아래 ‘수정’을 누르세요."
                : "재고에서 담는 즉시 예약됩니다. 남은 재고 안에서 −/+ 하세요."}
          </div>
          <div className="itemshead">
            <span className="itemshead__label">재고 연동 상품</span>
            <span className="itemshead__count">{linked.length}개</span>
          </div>
          {linked.map((p) => {
            const avail = live.availableOf(p.id, availableByProduct[p.id] ?? 0);
            const mineQ = live.mineOf(p.id, qtyByProduct[p.id] ?? 0);
            return (
              <div className="resv-item" key={p.id}>
                <div className="resv-item__main">
                  <div className="resv-item__name">{p.name}</div>
                  <div className="resv-item__price">
                    {p.pickupDate && (
                      <span className="resv-item__pickup">픽업 {labelDate(p.pickupDate)}</span>
                    )}
                    남은 수량 {avail}개 · 공급가 {won(p.supplyPrice)}원
                  </div>
                </div>
                {locked ? (
                  <div className="resv-item__fixed">{mineQ > 0 ? `${mineQ}개` : "-"}</div>
                ) : (
                  <ReservationStockStepper
                    batchId={batchId}
                    productId={p.id}
                    available={avail}
                    mine={mineQ}
                    disabled={locked}
                    onChanged={live.refresh}
                  />
                )}
              </div>
            );
          })}
        </>
      )}

      {/* 수기 입력 상품 — 수량 입력(확정 시 잠김) */}
      {manual.length > 0 && (
        <div style={{ marginTop: linked.length > 0 ? 22 : 0 }}>
          <div className="itemshead">
            <span className="itemshead__label">예약 상품</span>
            <span className="itemshead__count">{manual.length}개</span>
          </div>
          {manual.map((p) => {
            const shownQty = qtyByProduct[p.id] ?? 0;
            return (
              <div className="resv-item" key={p.id}>
                <div className="resv-item__main">
                  <div className="resv-item__name">{p.name}</div>
                  <div className="resv-item__price">
                    {p.pickupDate && (
                      <span className="resv-item__pickup">픽업 {labelDate(p.pickupDate)}</span>
                    )}
                    공급가 {won(p.supplyPrice)}원
                  </div>
                </div>
                {locked ? (
                  <div className="resv-item__fixed">{shownQty > 0 ? `${shownQty}개` : "-"}</div>
                ) : (
                  <div className="resv-item__qty">
                    <input
                      className="input"
                      inputMode="numeric"
                      value={qty[p.id] ?? ""}
                      onChange={(e) => setQty((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="0"
                      aria-label={`${p.name} 수량`}
                    />
                    <span>개</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 하단 액션 — 예약 확정(연동·수기 전체 잠금) / 수정(잠금 풀기) */}
      {closed ? (
        <div className="resv-lock resv-lock--closed" style={{ marginTop: 16 }}>
          예약일자가 지났습니다 · 예약이 마감되었어요
        </div>
      ) : confirmed ? (
        <form action={unlockReservationAction} style={{ marginTop: 16 }}>
          <input type="hidden" name="batchId" value={batchId} />
          <SubmitButton className="btn btn--soft btn--block" pendingText="여는 중…">
            수정 (잠금 풀기)
          </SubmitButton>
        </form>
      ) : (
        <form action={confirmReservationAction} style={{ marginTop: 16 }}>
          <input type="hidden" name="batchId" value={batchId} />
          <input type="hidden" name="items" value={JSON.stringify(items)} />
          <div className="resv-lock">
            예약 확정을 누르면 예약이 확정되고 잠깁니다. (재고 연동 상품도 함께 잠겨요)
          </div>
          <div className="ctabar">
            <SubmitButton
              className="btn btn--primary btn--block"
              pendingText="확정 중…"
              disabled={totalReserved === 0}
            >
              예약 확정 {totalReserved > 0 ? `(${totalReserved}개)` : ""}
            </SubmitButton>
          </div>
        </form>
      )}
    </>
  );
}
