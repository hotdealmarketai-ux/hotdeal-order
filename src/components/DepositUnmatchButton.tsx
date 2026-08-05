"use client";

import { useActionState } from "react";
import { unmatchDepositAction } from "@/app/actions/deposit";
import { SubmitButton } from "./SubmitButton";

// 점포 상세 원장에서 '매칭 해제' — 이 입금 매칭을 풀어 미수를 원복(그 입금은 다시 입출금내역 미매칭 큐로).
// 옛 자동매칭으로 계산서에 귀속된 입금은 서버가 막고 안내 메시지를 돌려준다.
export function DepositUnmatchButton({ depositId }: { depositId: string }) {
  const [state, action] = useActionState<{ error?: string }, FormData>(
    async (_prev, fd) => (await unmatchDepositAction(fd)) || {},
    {},
  );
  return (
    <form action={action} style={{ textAlign: "right" }}>
      <input type="hidden" name="depositId" value={depositId} />
      {state.error && (
        <div
          className="row__sub"
          style={{ color: "var(--danger)", marginBottom: 4, maxWidth: 200 }}
        >
          {state.error}
        </div>
      )}
      <SubmitButton className="btn btn--xs btn--soft" pendingText="해제 중…">
        매칭 해제
      </SubmitButton>
    </form>
  );
}
