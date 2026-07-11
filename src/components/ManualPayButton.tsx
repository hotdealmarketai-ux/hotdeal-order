"use client";

import { useState } from "react";
import { markInvoicePaidAction } from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";

// 관리자 수동 입금확인 — 분할입금·차액 등 자동매칭이 못 잡는 건을 확정
export function ManualPayButton({
  invoiceId,
  block = false,
}: {
  invoiceId: string;
  block?: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className={block ? "btn btn--block btn--soft" : "btn btn--xs btn--ghost"}
        style={block ? undefined : { width: "auto" }}
        onClick={() => setOpen(true)}
      >
        수동 입금확인
      </button>
    );
  }

  return (
    <form action={markInvoicePaidAction} className="confirm" style={{ marginTop: 10 }}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="confirm__title">입금 확인 처리할까요?</div>
      <p className="confirm__hint">
        점주에게 입금 확인 알림이 가고, 이후 자동매칭이 되돌리지 않아요.
      </p>
      <div className="confirm__actions">
        <button
          type="button"
          className="btn btn--xs btn--ghost"
          onClick={() => setOpen(false)}
        >
          취소
        </button>
        <SubmitButton className="btn btn--xs btn--primary" pendingText="처리 중…">
          네, 입금 확인
        </SubmitButton>
      </div>
    </form>
  );
}
