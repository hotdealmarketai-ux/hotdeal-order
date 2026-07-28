"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { holdReservationAction } from "@/app/actions/reservation";

// 예약발주 연동(재고) 상품 인라인 +/- — 담는 즉시 예약수량=재고홀드로 저장(초과차단·공유).
// 일일 InlineStockStepper와 같은 개념이나 holdReservationAction(배치·상품 단위) 사용.
// available=실시간 남은수량(내 것 포함 차감), mine=내 예약수량. onChanged=폴링 즉시 갱신.
export function ReservationStockStepper({
  batchId,
  productId,
  available,
  mine,
  disabled,
  onChanged,
}: {
  batchId: string;
  productId: string;
  available: number;
  mine: number;
  disabled?: boolean;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(mine);

  useEffect(() => {
    setQty(mine);
  }, [mine]);

  const maxForMe = available + mine;

  const set = (next: number) => {
    const clamped = Math.max(0, Math.min(next, maxForMe));
    if (clamped === qty || pending || disabled) return;
    setQty(clamped); // 낙관적
    start(async () => {
      const res = await holdReservationAction({ batchId, productId, qty: clamped });
      if (!res.ok) {
        onChanged?.(); // 초과 등 실패 → 서버 기준 재동기화
        return;
      }
      router.refresh();
      onChanged?.(); // 내 변경을 즉시 반영
    });
  };

  return (
    <div className="stepper stepper--inline" role="group" aria-label="예약 수량">
      <button
        type="button"
        className="stepper__btn"
        aria-label="빼기"
        onClick={() => set(qty - 1)}
        disabled={disabled || pending || qty <= 0}
      >
        −
      </button>
      <span className="stepper__val">{qty}</span>
      <button
        type="button"
        className="stepper__btn"
        aria-label="담기"
        onClick={() => set(qty + 1)}
        disabled={disabled || pending || qty >= maxForMe}
      >
        +
      </button>
    </div>
  );
}
