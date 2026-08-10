"use client";

import { useActionState, useRef, useState } from "react";
import {
  matchDepositManuallyAction,
  unmatchDepositAction,
  deleteDepositAction,
} from "@/app/actions/deposit";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";
import { ConfirmSheet } from "./ConfirmSheet";

type StoreOpt = { id: string; label: string };

const won = (n: number) => n.toLocaleString("ko-KR");

// 입출금내역 1건 컨트롤 — 관리자가 점포로 '수동' 매칭(그 점포 미수가 그만큼 차감)하거나,
// 이미 매칭된 건 매칭 해제, 미매칭 건은 목록에서 삭제. 자동매칭은 없음(사용자 결정, 위험).
export function DepositMatchControl({
  depositId,
  payerName,
  amount,
  stores,
  matched = false,
}: {
  depositId: string;
  payerName: string;
  amount?: number;
  stores: StoreOpt[];
  matched?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false); // 삭제 확인 대기
  const delFormRef = useRef<HTMLFormElement>(null);
  const [unmatchState, unmatchAction] = useActionState<{ error?: string }, FormData>(
    async (_prev, fd) => (await unmatchDepositAction(fd)) || {},
    {},
  );

  // 이미 매칭된 입금 → '매칭 해제'만(해제하면 그 점포 미수가 다시 그만큼 늘어남).
  if (matched) {
    return (
      <form action={unmatchAction} style={{ textAlign: "right" }}>
        <input type="hidden" name="depositId" value={depositId} />
        {unmatchState.error && (
          <div
            className="row__sub"
            style={{ color: "var(--danger)", marginBottom: 6, maxWidth: 220 }}
          >
            {unmatchState.error}
          </div>
        )}
        <SubmitButton className="btn btn--xs btn--soft" pendingText="해제 중…">
          매칭 해제
        </SubmitButton>
      </form>
    );
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          gap: 6,
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "flex-end",
        }}
      >
        <button
          type="button"
          className="btn btn--xs btn--primary"
          onClick={() => setOpen(true)}
        >
          매칭
        </button>
        {/* 목록에서 삭제 — 확인 후 삭제. 미수와 무관. */}
        <form action={deleteDepositAction} ref={delFormRef}>
          <input type="hidden" name="depositId" value={depositId} />
          <button
            type="button"
            aria-label="목록에서 삭제"
            title="목록에서 삭제"
            onClick={() => setConfirmDel(true)}
            style={{
              border: "none",
              background: "transparent",
              cursor: "pointer",
              color: "var(--muted-2)",
              fontSize: 16,
              lineHeight: 1,
              padding: "2px 5px",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </form>
      </div>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">입금 매칭</div>
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
              {payerName ? `입금자 ‘${payerName}’` : "입금자명 없음"}
              {typeof amount === "number" && ` · ${won(amount)}원`} 을(를) 어느 점포로
              매칭할까요?
              <br />
              <span style={{ color: "var(--muted-2)" }}>
                매칭하면 그 점포 미수가 이 금액만큼 줄어듭니다.
              </span>
            </p>

            <form action={matchDepositManuallyAction} className="stack" style={{ gap: 12 }}>
              <input type="hidden" name="depositId" value={depositId} />
              <select name="userId" className="input" defaultValue="" required>
                <option value="" disabled>
                  점포 선택
                </option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div
                className="sheet__foot"
                style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}
              >
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setOpen(false)}
                >
                  닫기
                </button>
                <SubmitButton className="btn btn--primary" pendingText="처리 중…">
                  이 점포로 매칭
                </SubmitButton>
              </div>
            </form>
          </div>
        </Sheet>
      )}

      {confirmDel && (
        <ConfirmSheet
          onConfirm={() => delFormRef.current?.requestSubmit()}
          onClose={() => setConfirmDel(false)}
        />
      )}
    </>
  );
}
