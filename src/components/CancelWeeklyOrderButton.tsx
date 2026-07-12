"use client";

import { useState } from "react";
import { cancelWeeklyOrderAction } from "@/app/actions/weekly-order";

// 점주: 이번 주 주간발주 취소. 실행 직전 한 번 더 확인.
export function CancelWeeklyOrderButton() {
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
    <form action={cancelWeeklyOrderAction} className="confirm" style={{ marginTop: 10 }}>
      <input type="hidden" name="confirm" value="CANCEL-WEEKLY" />
      <div className="confirm__title">이번 주간발주를 취소할까요?</div>
      <p className="confirm__hint">
        취소하면 이번 주 주간발주가 삭제돼요. 다시 넣으려면 주간발주 시간에 새로 넣어야 해요.
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
