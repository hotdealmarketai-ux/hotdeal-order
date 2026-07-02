"use client";

import { useState } from "react";
import { requestSplitPaymentAction } from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";

// 점주 입금요청서에서 '분할 입금 요청' — 관리자에게 수동 확인 요청을 남긴다
export function SplitPaymentButton({
  invoiceId,
  alreadyRequested,
}: {
  invoiceId: string;
  alreadyRequested: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (alreadyRequested) {
    return (
      <div className="notice notice--mute" style={{ marginTop: 12 }}>
        분할 입금 요청이 접수됐어요. 새롭에서 확인 후 처리해 드려요.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        className="btn btn--ghost"
        style={{ marginTop: 12 }}
        onClick={() => setOpen(true)}
      >
        분할 입금 요청
      </button>
    );
  }

  return (
    <form
      action={requestSplitPaymentAction}
      className="confirm"
      style={{ marginTop: 12 }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <div className="confirm__title">나눠서 입금할까요?</div>
      <p className="confirm__hint">
        요청하면 새롭에서 확인하고, 입금 상황에 맞춰 수동으로 처리해 드려요.
      </p>
      <div className="confirm__actions">
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => setOpen(false)}
        >
          취소
        </button>
        <SubmitButton pendingText="요청 중…">분할 입금 요청하기</SubmitButton>
      </div>
    </form>
  );
}
