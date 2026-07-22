"use client";

import { useMemo, useState } from "react";
import {
  confirmReservationAction,
  unlockReservationAction,
} from "@/app/actions/reservation";
import { SubmitButton } from "./SubmitButton";
import type { ReservationProductRow } from "@/lib/reservation-data";

const won = (n: number) => n.toLocaleString("ko-KR");

export function ReservationOrderForm({
  batchId,
  products,
  confirmed,
  qtyByProduct,
  closed,
}: {
  batchId: string;
  products: ReservationProductRow[];
  confirmed: boolean;
  qtyByProduct: Record<string, number>;
  closed: boolean;
}) {
  const [qty, setQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const p of products) {
      const q = qtyByProduct[p.id] ?? 0;
      m[p.id] = q > 0 ? String(q) : "";
    }
    return m;
  });

  const toNum = (s: string) => Math.max(0, Math.floor(Number(String(s).replace(/[^\d]/g, "")) || 0));
  const items = useMemo(
    () =>
      products
        .map((p) => ({ productId: p.id, qty: toNum(qty[p.id] ?? "") }))
        .filter((i) => i.qty > 0),
    [products, qty],
  );
  const totalQty = items.reduce((s, i) => s + i.qty, 0);

  // 잠금 상태: 마감됐거나(closed), 확정됨(confirmed) → 입력 불가
  const locked = closed || confirmed;

  return (
    <>
      {closed ? (
        <div className="resv-lock resv-lock--closed">예약일자가 지났습니다 · 예약이 마감되었어요</div>
      ) : confirmed ? (
        <div className="resv-lock">예약이 확정되어 잠겨 있어요. 수정하려면 아래 ‘수정’을 누르세요.</div>
      ) : (
        <div className="resv-lock">필요한 수량을 적고 ‘예약 확정’을 누르면 예약됩니다.</div>
      )}

      <form action={confirmReservationAction}>
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="items" value={JSON.stringify(items)} />

        <div className="itemshead">
          <span className="itemshead__label">예약 상품</span>
          <span className="itemshead__count">{products.length}개</span>
        </div>

        {products.map((p) => {
          const shownQty = qtyByProduct[p.id] ?? 0;
          return (
            <div className="resv-item" key={p.id}>
              <div className="resv-item__main">
                <div className="resv-item__name">{p.name}</div>
                <div className="resv-item__price">공급가 {won(p.supplyPrice)}원</div>
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

        {!locked && (
          <div className="ctabar">
            <SubmitButton
              className="btn btn--primary btn--block"
              pendingText="확정 중…"
              disabled={totalQty === 0}
            >
              예약 확정 {totalQty > 0 ? `(${totalQty}개)` : ""}
            </SubmitButton>
          </div>
        )}
      </form>

      {confirmed && !closed && (
        <form action={unlockReservationAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="batchId" value={batchId} />
          <SubmitButton className="btn btn--soft btn--block" pendingText="여는 중…">
            수정 (잠금 풀기)
          </SubmitButton>
        </form>
      )}
    </>
  );
}
