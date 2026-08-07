"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setMerchantStepDoneAction } from "@/app/actions/onboarding";

// 점주 '완료했어요' 토글. 본사 확인과 합쳐 둘 다면 단계 확정(이중 확인).
export function OnboardingCheckButton({
  stepId,
  done,
}: {
  stepId: string;
  done: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");

  const toggle = () =>
    start(async () => {
      const res = await setMerchantStepDoneAction({ stepId, done: !done });
      if (res.error) {
        setErr(res.error);
        return;
      }
      setErr("");
      router.refresh();
    });

  return (
    <div style={{ marginTop: 16 }}>
      <button
        type="button"
        className={`btn btn--block ${done ? "btn--soft" : "btn--primary"}`}
        onClick={toggle}
        disabled={pending}
      >
        {pending ? "저장 중…" : done ? "완료 취소" : "완료했어요"}
      </button>
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
    </div>
  );
}
