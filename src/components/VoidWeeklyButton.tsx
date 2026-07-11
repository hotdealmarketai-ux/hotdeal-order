"use client";

import { useState } from "react";
import { voidWeeklyInvoiceAction } from "@/app/actions/weekly-invoice";

// 주간발주 입금요청서 취소(VOID) — 잘못 발행 시. 실행 직전 한 번 더 확인.
export function VoidWeeklyButton({ invoiceId }: { invoiceId: string }) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button"
        className="linkbtn linkbtn--danger"
        onClick={() => setOpen(true)}
      >
        입금요청서 취소
      </button>
    );
  }

  return (
    <form action={voidWeeklyInvoiceAction} className="confirm" style={{ marginTop: 10 }}>
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="confirm" value="VOID-WEEKLY" />
      <div className="confirm__title">정말 이 입금요청서를 취소할까요?</div>
      <p className="confirm__hint">취소하면 되돌릴 수 없어요. 필요하면 다시 발행하세요.</p>
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
