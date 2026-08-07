"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminSetStepDoneAction,
  startOnboardingAction,
  cancelOnboardingAction,
} from "@/app/actions/onboarding";

// 본사 '확인' 토글(이중 확인의 본사 측).
export function AdminConfirmButton({
  userId,
  stepId,
  done,
}: {
  userId: string;
  stepId: string;
  done: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const res = await adminSetStepDoneAction({ userId, stepId, done: !done });
      if (res.error) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  return (
    <button
      type="button"
      className={`btn btn--xs ${done ? "btn--soft" : "btn--primary"}`}
      onClick={toggle}
      disabled={pending}
    >
      {pending ? "…" : done ? "본사 확인 해제" : "본사 확인"}
    </button>
  );
}

// 한 점포의 온보딩 시작(발주 잠금).
export function StartOnboardingButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      const res = await startOnboardingAction({ userId });
      if (res.error) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  return (
    <button
      type="button"
      className="btn btn--xs btn--soft"
      onClick={go}
      disabled={pending}
    >
      {pending ? "시작 중…" : "튜토리얼 시작"}
    </button>
  );
}

// 온보딩(오픈 튜토리얼) 취소 — 발주 잠금 해제. 잘못 시작했을 때 되돌린다.
export function CancelOnboardingButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      if (
        !confirm(
          "오픈 튜토리얼을 취소할까요? 발주 잠금이 풀리고 바로 발주할 수 있게 됩니다. (완료한 단계 기록은 남아 다시 시작하면 이어져요.)",
        )
      )
        return;
      const res = await cancelOnboardingAction({ userId });
      if (res.error) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  return (
    <button
      type="button"
      className="btn btn--soft btn--block"
      onClick={go}
      disabled={pending}
    >
      {pending ? "취소 중…" : "오픈 튜토리얼 취소 (발주 잠금 해제)"}
    </button>
  );
}
