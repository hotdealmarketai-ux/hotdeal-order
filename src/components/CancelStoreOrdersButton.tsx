"use client";

import { useActionState, useEffect, useState } from "react";
import {
  cancelStoreOrdersAction,
  type CancelOrdersState,
} from "@/app/actions/admin";
import { SubmitButton } from "./SubmitButton";

// 지점 발주 전체 취소 — 관리자가 핫딜마켓 발주관리에서 지점별로 취소.
// useActionState로 결과를 받아 성공 시 모달을 명시적으로 닫는다(리다이렉트 상태 잔존으로
// 확인창이 계속 다시 뜨던 문제 방지). 삭제되면 revalidate로 지점 행 자체가 사라진다.
export function CancelStoreOrdersButton({
  userId,
  date,
  store,
}: {
  userId: string;
  date: string;
  store: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [state, formAction] = useActionState<CancelOrdersState, FormData>(
    cancelStoreOrdersAction,
    {},
  );

  useEffect(() => {
    if (state?.ok) setConfirming(false);
  }, [state]);

  return (
    <>
      <button
        type="button"
        className="btn btn--xs btn--danger"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        발주 취소
      </button>

      {confirming && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
        >
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">{store} 발주를 취소할까요?</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={() => setConfirming(false)}
              >
                ✕
              </button>
            </div>
            <p className="sheet__hint">
              이 지점이 이 날짜에 넣은 발주가 <b>모두 취소·삭제</b>됩니다.
              점주에게 &lsquo;발주가 취소되었습니다&rsquo; 알림이 가고, 잠겨 있던
              발주창은 다시 열려요. 되돌릴 수 없어요.
            </p>
            <div className="sheet__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirming(false)}
              >
                닫기
              </button>
              <form action={formAction} style={{ flex: 1 }}>
                <input type="hidden" name="confirm" value="CANCEL-STORE-ORDERS" />
                <input type="hidden" name="userId" value={userId} />
                <input type="hidden" name="date" value={date} />
                <SubmitButton className="btn btn--danger" pendingText="취소 중…">
                  네, 발주 취소
                </SubmitButton>
              </form>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
