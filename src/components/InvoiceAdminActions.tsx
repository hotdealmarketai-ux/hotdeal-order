"use client";

import { useState } from "react";
import {
  unmarkInvoicePaidAction,
  voidInvoiceAction,
} from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";

// 발행된 계산서의 관리자 액션 — 계산서 취소 / (레거시)입금확인 취소.
// 입금(미수 정산)은 '입금 관리 > 입출금내역 매칭'으로만 처리한다(계산서 개별 입금확인 폐지, 2026-08-05).
export function InvoiceAdminActions({
  invoiceId,
  status,
}: {
  invoiceId: string;
  status: string;
}) {
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [confirmUnpay, setConfirmUnpay] = useState(false);

  if (status === "ISSUED") {
    return (
      <div style={{ marginTop: 18 }}>
        {!confirmVoid && (
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--danger btn--block"
              onClick={() => setConfirmVoid(true)}
            >
              계산서 취소
            </button>
          </div>
        )}

        {confirmVoid && (
          <form action={voidInvoiceAction} className="confirm">
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="confirm" value="VOID-INVOICE" />
            <div className="confirm__title">정말 이 계산서를 취소할까요?</div>
            <p className="confirm__hint">
              점주 화면에서 사라지고 되돌릴 수 없어요. 다시 보내려면 발주서에서
              새로 작성하세요.
            </p>
            <div className="confirm__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmVoid(false)}
              >
                취소
              </button>
              <SubmitButton pendingText="처리 중…">네, 취소합니다</SubmitButton>
            </div>
          </form>
        )}
      </div>
    );
  }

  if (status === "PAID") {
    return (
      <div style={{ marginTop: 18 }}>
        {!confirmUnpay ? (
          <button
            type="button"
            className="linkbtn linkbtn--danger"
            onClick={() => setConfirmUnpay(true)}
          >
            입금확인 취소 (실수 복구)
          </button>
        ) : (
          <form action={unmarkInvoicePaidAction} className="confirm">
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <div className="confirm__title">
              입금확인을 취소하고 다시 &lsquo;입금 대기&rsquo;로 둘까요?
            </div>
            <div className="confirm__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmUnpay(false)}
              >
                취소
              </button>
              <SubmitButton pendingText="처리 중…">네, 되돌립니다</SubmitButton>
            </div>
          </form>
        )}
      </div>
    );
  }

  return null;
}
