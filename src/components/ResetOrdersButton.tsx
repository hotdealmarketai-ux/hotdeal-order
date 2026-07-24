"use client";

import { useState } from "react";
import { resetAllOrdersAction } from "@/app/actions/admin";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";

// 관리자 전용 '전체 발주 초기화' — 헤더(sticky .tbar)에 놓여도 안 깨지게 확인 모달을
// body로 포탈(Sheet). 안 그러면 .tbar 스택 컨텍스트에 갇혀 하단 네비 뒤로 숨는다.
export function ResetOrdersButton() {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const close = () => {
    setConfirming(false);
    setTyped("");
  };

  return (
    <>
      <button
        type="button"
        className="topbar__reset"
        onClick={() => setConfirming(true)}
      >
        초기화
      </button>

      {confirming && (
        <Sheet onClose={close}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">정말 전체 발주를 지울까요?</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={close}
              >
                ✕
              </button>
            </div>
            <p className="sheet__hint">
              모든 발주 내역이 영구히 삭제됩니다. 되돌릴 수 없어요.
              <br />
              확인을 위해 아래에 <b>초기화</b> 라고 입력해 주세요.
            </p>
            <input
              className="input"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="초기화"
              aria-label="초기화 입력"
              style={{ marginTop: 4 }}
            />
            <div className="sheet__foot">
              <button type="button" className="btn btn--ghost" onClick={close}>
                취소
              </button>
              <form action={resetAllOrdersAction} style={{ flex: 1 }}>
                <input type="hidden" name="confirm" value="RESET-ALL-ORDERS" />
                <SubmitButton
                  className="btn btn--danger"
                  pendingText="삭제 중…"
                  disabled={typed.trim() !== "초기화"}
                >
                  네, 전부 삭제
                </SubmitButton>
              </form>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
