"use client";

import { useState } from "react";
import {
  approveCancelRequestAction,
  rejectCancelRequestAction,
} from "@/app/actions/order-cancel";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";

// 점주가 올린 발주 취소요청을 관리자가 승인/반려한다.
// 승인 → status=CANCELLED + 점주에게 '취소 요청 승인이 완료되었습니다' 알림.
// 반려 → 요청만 해제(발주 유지) + 점주에게 반려 알림. 서버액션이 redirect하므로 재로딩으로 반영.
export function CancelRequestActions({
  userId,
  store,
}: {
  userId: string;
  store: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="linkbtn linkbtn--danger"
        style={{ fontSize: 12.5, fontWeight: 700 }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        취소요청 처리
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">{store} 취소 요청</div>
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
              점주가 이 발주의 <b>취소를 요청</b>했어요. 승인하면 발주가 취소되고
              점주에게 &lsquo;취소 요청 승인이 완료되었습니다&rsquo; 알림이 가요.
              반려하면 발주는 그대로 유지되고 점주에게 반려 알림이 가요.
            </p>
            <div className="sheet__foot">
              <form action={rejectCancelRequestAction} style={{ flex: 1 }}>
                <input type="hidden" name="userId" value={userId} />
                <SubmitButton className="btn btn--ghost" pendingText="반려 중…">
                  반려
                </SubmitButton>
              </form>
              <form action={approveCancelRequestAction} style={{ flex: 1 }}>
                <input type="hidden" name="userId" value={userId} />
                <SubmitButton className="btn btn--danger" pendingText="취소 중…">
                  취소 승인
                </SubmitButton>
              </form>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
