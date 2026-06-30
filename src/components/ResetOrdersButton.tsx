"use client";

import { useState } from "react";
import { resetAllOrdersAction } from "@/app/actions/admin";
import { SubmitButton } from "./SubmitButton";

// 관리자 전용 '전체 발주 초기화' — 2단계 확인 후 모든 발주 삭제(회원·재고는 유지).
export function ResetOrdersButton() {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn--ghost"
        style={{ color: "var(--danger)", borderColor: "var(--danger)" }}
        onClick={() => setConfirming(true)}
      >
        전체 발주 초기화
      </button>
    );
  }

  return (
    <div className="confirm">
      <div className="confirm__title">정말 전체 발주를 지울까요?</div>
      <p className="confirm__hint">
        모든 발주 내역이 영구히 삭제됩니다. 되돌릴 수 없어요. (회원·재고는 유지)
      </p>
      <div className="confirm__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setConfirming(false)}
        >
          취소
        </button>
        <form action={resetAllOrdersAction}>
          <input type="hidden" name="confirm" value="RESET-ALL-ORDERS" />
          <SubmitButton pendingText="삭제 중…">네, 전부 삭제</SubmitButton>
        </form>
      </div>
    </div>
  );
}
