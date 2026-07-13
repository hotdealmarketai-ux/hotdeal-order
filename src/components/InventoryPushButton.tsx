"use client";

import { useActionState } from "react";
import {
  pushInventoryToSheetAction,
  type PushInvState,
} from "@/app/actions/admin";

// #22 관리자 '지금 시트로 내보내기' — DB 전체를 구글시트에 다시 써서 정합을 맞춘다.
export function InventoryPushButton() {
  const [state, action, pending] = useActionState<PushInvState, FormData>(
    pushInventoryToSheetAction,
    {},
  );
  return (
    <form action={action} className="stack" style={{ gap: 6 }}>
      <button className="btn btn--soft btn--block" disabled={pending}>
        {pending ? "시트로 내보내는 중…" : "지금 시트로 내보내기"}
      </button>
      {state.ok === true && (
        <p className="hint" style={{ color: "var(--green-700)", margin: 0 }}>
          시트에 반영했어요.
        </p>
      )}
      {state.ok === false && state.error && (
        <p className="hint" style={{ color: "var(--danger)", margin: 0 }}>
          {state.error}
        </p>
      )}
    </form>
  );
}
