"use client";

import { Sheet } from "./Sheet";

// 파괴적 액션(삭제 등) 공용 확인창 — 보조설명 없이 제목 한 줄 + 취소/확인.
// 반드시 Sheet(body 포탈)로 띄워 transform-trap(모달이 네비 뒤로 숨는 버그)을 피한다.
export function ConfirmSheet({
  title = "정말 지울까요?",
  confirmLabel = "삭제",
  onConfirm,
  onClose,
}: {
  title?: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose}>
      <div className="sheet__panel" style={{ maxWidth: 340 }}>
        <div
          className="confirm__title"
          style={{ marginBottom: 0, textAlign: "center" }}
        >
          {title}
        </div>
        <div className="confirm__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            취소
          </button>
          <button
            type="button"
            className="btn btn--danger"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
