"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  adminSetStepDoneAction,
  startOnboardingAction,
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
      {pending ? "시작 중…" : "온보딩 시작"}
    </button>
  );
}
