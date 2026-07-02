"use client";

import { useState } from "react";
import {
  markInvoicePaidAction,
  unmarkInvoicePaidAction,
  voidInvoiceAction,
} from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 발행된 계산서의 관리자 액션 — 입금 확인(수동) / 계산서 취소 / 입금확인 취소
export function InvoiceAdminActions({
  invoiceId,
  status,
  total,
}: {
  invoiceId: string;
  status: string;
  total: number;
}) {
  const [confirmPaid, setConfirmPaid] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [confirmUnpay, setConfirmUnpay] = useState(false);

  if (status === "ISSUED") {
    return (
      <div style={{ marginTop: 18 }}>
        {!confirmPaid && !confirmVoid && (
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirmVoid(true)}
            >
              계산서 취소
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => setConfirmPaid(true)}
            >
              입금 확인
            </button>
          </div>
        )}

        {confirmPaid && (
          <form action={markInvoicePaidAction} className="confirm">
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <div className="confirm__title">
              정말 입금 확인 처리할까요? · {fmt(total)}원
            </div>
            <p className="confirm__hint">
              점주에게 &lsquo;입금이 확인되었습니다&rsquo; 알림이 가고, 미수에서
              빠져요.
            </p>
            <div className="confirm__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirmPaid(false)}
              >
                취소
              </button>
              <SubmitButton pendingText="처리 중…">네, 입금 확인</SubmitButton>
            </div>
          </form>
        )}

        {confirmVoid && (
          <form action={voidInvoiceAction} className="confirm">
            <input type="hidden" name="invoiceId" value={invoiceId} />
            <input type="hidden" name="confirm" value="VOID-INVOICE" />
            <div className="confirm__title">정말 이 계산서를 취소할까요?</div>
            <p className="confirm__hint">
              점주 화면에서 사라지고 되돌릴 수 없어요. 다시 보내려면 합본
              발주서에서 새로 작성하세요.
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
