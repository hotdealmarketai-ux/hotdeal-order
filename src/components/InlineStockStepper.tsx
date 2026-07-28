"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { holdStockAction } from "@/app/actions/stock";
import { refreshLiveStock } from "@/lib/useLiveStock";

// 공구 발주 인라인 +/- — 담은 수량을 그 자리에서 조절(바텀시트 없이). 담기원장(StockHold)에 절대값으로
// 실시간 반영: 서버 holdStockAction(FOR UPDATE·초과차단) + refreshLiveStock()로 전 지점에 즉시 공유.
// available=실시간 남은수량(전체 담기 반영, 내 것 포함 차감), mine=내가 담은 수량.
export function InlineStockStepper({
  itemId,
  available,
  mine,
  disabled,
}: {
  itemId: string;
  available: number;
  mine: number;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [qty, setQty] = useState(mine); // 낙관적 담음 수량(클릭 즉시 반영)

  // 폴링/서버 반영으로 내 담음 수량이 바뀌면 스테퍼도 동기화(다른 화면·기기에서 바꾼 것 포함)
  useEffect(() => {
    setQty(mine);
  }, [mine]);

  const maxForMe = available + mine; // 내가 담을 수 있는 최대(남은 + 내가 이미 담은 것)

  const set = (next: number) => {
    const clamped = Math.max(0, Math.min(next, maxForMe));
    if (clamped === qty || pending || disabled) return;
    setQty(clamped); // 낙관적
    start(async () => {
      const res = await holdStockAction({ itemId, qty: clamped });
      if (!res.ok) {
        refreshLiveStock(); // 초과 등 실패 → 서버 기준으로 재동기화
        return;
      }
      router.refresh();
      refreshLiveStock(); // 내 변경을 전 지점에 즉시 반영
    });
  };

  return (
    <div className="stepper stepper--inline" role="group" aria-label="담을 수량">
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
