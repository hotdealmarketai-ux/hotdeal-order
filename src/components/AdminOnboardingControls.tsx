"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  startOnboardingAction,
  cancelOnboardingAction,
} from "@/app/actions/onboarding";

// 한 점포의 튜토리얼 시작(발주 잠금).
export function StartOnboardingButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      if (
        !confirm(
          "튜토리얼을 시작할까요? 이전 체크는 초기화되고, 100%가 될 때까지 이 지점의 발주가 잠깁니다.",
        )
      )
        return;
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

// 튜토리얼 취소 — 발주 잠금 해제. 잘못 시작했을 때 되돌린다.
export function CancelOnboardingButton({ userId }: { userId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = () =>
    start(async () => {
      if (
        !confirm(
          "튜토리얼을 취소할까요? 발주 잠금이 풀리고 바로 발주할 수 있게 됩니다. (다시 시작하면 처음부터 새로 진행되며, 이전 체크는 모두 초기화돼요.)",
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
      {pending ? "취소 중…" : "튜토리얼 취소 (발주 잠금 해제)"}
    </button>
  );
}
