"use client";

import { useState } from "react";
import { deleteReceivableAdjustmentAction } from "@/app/actions/deposit";
import { SubmitButton } from "./SubmitButton";

// 미수 조정 내역 삭제 — 한 번 되물어보고 삭제(금액에 영향 가는 조작이라).
export function ReceivableAdjustDeleteButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        className="btn btn--xs btn--ghost"
        onClick={() => setConfirming(true)}
      >
        삭제
      </button>
    );
  }

  return (
    <form
      action={deleteReceivableAdjustmentAction}
      style={{ display: "flex", gap: 4, margin: 0 }}
    >
      <input type="hidden" name="id" value={id} />
      <button
        type="button"
        className="btn btn--xs btn--ghost"
        onClick={() => setConfirming(false)}
      >
        취소
      </button>
      <SubmitButton className="btn btn--xs btn--danger" pendingText="…">
        삭제
      </SubmitButton>
    </form>
  );
}
