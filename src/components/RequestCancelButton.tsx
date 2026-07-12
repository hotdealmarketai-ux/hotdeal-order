"use client";

import { useState } from "react";
import { requestCancelOrderAction } from "@/app/actions/order-cancel";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";

// 점주: 이미 넣은 발주를 '취소 요청'. 확인창(예/아니오) 후 관리자에게 취소 요청을 보낸다.
// 실제 취소는 관리자 승인 시. requestCancelOrderAction이 redirect(?cancelReq=1 | ?cancelErr=)하므로 재로딩으로 반영.
export function RequestCancelButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="btn btn--ghost"
        onClick={() => setOpen(true)}
      >
        발주 취소 요청
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">진짜 발주를 취소하시겠습니까?</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>
            <p className="sheet__hint">
              관리자에게 <b>발주 취소를 요청</b>해요. 관리자가 승인하면 발주가
              취소되고 발주창이 다시 열려요. (이미 계산서가 발행된 경우에는 취소할
              수 없어요.)
            </p>
            <div className="sheet__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setOpen(false)}
              >
                아니오
              </button>
              <form action={requestCancelOrderAction} style={{ flex: 1 }}>
                <input type="hidden" name="confirm" value="REQUEST-CANCEL" />
                <SubmitButton className="btn btn--danger" pendingText="요청 중…">
                  예, 취소 요청
                </SubmitButton>
              </form>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
