"use client";

import { useActionState, useEffect, useState } from "react";
import {
  cancelStoreOrdersAction,
  type CancelOrdersState,
} from "@/app/actions/admin";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";

// 지점 발주 전체 취소 — 관리자가 핫딜마켓 발주에서 지점별로 임의 취소.
// 하드삭제가 아니라 status=CANCELLED로 남겨 양쪽에 '취소 완료'로 표시되고 발주창이 다시 열린다.
// useActionState로 결과를 받아 성공 시 모달을 명시적으로 닫고(리다이렉트 상태 잔존으로
// 확인창이 계속 다시 뜨던 문제 방지), 계산서 발행 등으로 막히면 state.error를 그대로 보여준다.
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
        className="linkbtn linkbtn--danger"
        style={{ fontSize: 12.5, fontWeight: 700 }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setConfirming(true);
        }}
      >
        발주취소
      </button>

      {confirming && (
        <Sheet onClose={() => setConfirming(false)}>
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
              이 지점이 이 날짜에 넣은 발주가 <b>모두 취소</b>됩니다.
            </p>
            {state?.error && (
              <p
                className="sheet__hint"
                style={{ color: "var(--danger)", fontWeight: 700, marginTop: 0 }}
              >
                {state.error}
              </p>
            )}
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
        </Sheet>
      )}
    </>
  );
}
