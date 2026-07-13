"use client";

import { useState } from "react";
import { deleteWeeklyOrderAction } from "@/app/actions/weekly-order";

// 관리자: 특정 지점의 주간발주 삭제. 점주에게 취소 알림이 발송됨. 실행 직전 확인.
export function DeleteWeeklyOrderButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn--danger btn--block"
        onClick={() => setOpen(true)}
      >
        주간발주 취소
      </button>
    );
  }

  return (
    <form action={deleteWeeklyOrderAction} className="confirm" style={{ marginTop: 10 }}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="confirm" value="DELETE-WEEKLY-ORDER" />
      <div className="confirm__title">이 지점의 주간발주를 취소할까요?</div>
      <p className="confirm__hint">
        삭제하면 주간발주와 관련 입금요청서가 취소되고, 점주에게 &lsquo;관리자에 의해
        주간발주가 취소되었습니다&rsquo; 알림이 갑니다.
      </p>
      <div className="confirm__actions">
        <button
          type="button"
          className="btn btn--xs btn--ghost"
          onClick={() => setOpen(false)}
        >
          아니요
        </button>
        <button className="btn btn--xs btn--danger">네, 취소합니다</button>
      </div>
    </form>
  );
}
