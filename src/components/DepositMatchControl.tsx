"use client";

import { useState } from "react";
import {
  matchDepositManuallyAction,
  ignoreDepositAction,
} from "@/app/actions/deposit";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";

type StoreOpt = { id: string; label: string };

const won = (n: number) => n.toLocaleString("ko-KR");

// 미매칭 입금 1건을 관리자가 점포로 수동 매칭하거나 '무시' 처리.
// 목록에서는 제안 점포 버튼 + '매칭'만 노출하고, 자세한 선택은 바텀시트로 분리(화면 정리).
export function DepositMatchControl({
  depositId,
  payerName,
  amount,
  stores,
  suggestion,
}: {
  depositId: string;
  payerName: string;
  amount?: number;
  stores: StoreOpt[];
  suggestion?: {
    userId: string;
    storeName: string;
    reason: string;
    remember: boolean;
  };
}) {
  const [open, setOpen] = useState(false);

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
        {suggestion && (
          <form action={matchDepositManuallyAction}>
            <input type="hidden" name="depositId" value={depositId} />
            <input type="hidden" name="userId" value={suggestion.userId} />
            {suggestion.remember && (
              <input type="hidden" name="remember" value="true" />
            )}
            <SubmitButton
              className="btn btn--xs btn--primary"
              pendingText="처리 중…"
            >
              → {suggestion.storeName}
            </SubmitButton>
          </form>
        )}
        <button
          type="button"
          className="btn btn--xs btn--soft"
          onClick={() => setOpen(true)}
        >
          {suggestion ? "다른 점포" : "매칭"}
        </button>
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
              {payerName ? `입금자 '${payerName}'` : "입금자명 없음"}
              {typeof amount === "number" && ` · ${won(amount)}원`} 을(를) 어느
              점포로 처리할까요?
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
              {payerName && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 14,
                    color: "var(--muted)",
                  }}
                >
                  <input
                    type="checkbox"
                    name="remember"
                    value="true"
                    defaultChecked
                    style={{ width: 18, height: 18 }}
                  />
                  <span>
                    입금자명 &lsquo;{payerName}&rsquo; 을(를) 이 점포로 기억(다음부터 자동매칭)
                  </span>
                </label>
              )}
              <div className="sheet__foot" style={{ borderTop: "none", paddingTop: 0, marginTop: 0 }}>
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

            <form
              action={ignoreDepositAction}
              style={{ marginTop: 14, textAlign: "center" }}
            >
              <input type="hidden" name="depositId" value={depositId} />
              <button type="submit" className="linkbtn linkbtn--danger">
                점포 입금 아님 (무시)
              </button>
            </form>
          </div>
        </Sheet>
      )}
    </>
  );
}
