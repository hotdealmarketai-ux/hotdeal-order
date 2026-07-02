"use client";

import { useActionState } from "react";
import {
  collectDepositsAction,
  type CollectState,
} from "@/app/actions/deposit";
import { SubmitButton } from "./SubmitButton";

// 관리자 '지금 수집' 버튼 — 팝빌 계좌조회에서 최근 입금을 즉시 가져와 자동매칭
export function CollectDepositsButton() {
  const [state, formAction] = useActionState<CollectState, FormData>(
    collectDepositsAction,
    {},
  );
  const r = state?.result;

  return (
    <form action={formAction} style={{ marginBottom: 14 }}>
      {state?.error && (
        <div className="notice notice--error" style={{ marginBottom: 10 }}>
          {state.error}
        </div>
      )}
      {r && (
        <div
          className={`notice ${r.errors.length ? "notice--error" : "notice--ok"}`}
          style={{ marginBottom: 10 }}
        >
          {r.accounts === 0
            ? "팝빌에 등록된 계좌가 없어요. 계좌 등록 후 다시 수집해 주세요."
            : `✓ 입금 ${r.created}건 새로 수집 · 점포 매칭 ${r.matchedStores}건 · 자동 입금확인 ${r.paidInvoices}건`}
          {r.errors.length > 0 && ` · 오류: ${r.errors.join(", ")}`}
        </div>
      )}
      <SubmitButton pendingText="수집 중… (최대 30초)">
        지금 수집 (팝빌 계좌조회)
      </SubmitButton>
    </form>
  );
}
