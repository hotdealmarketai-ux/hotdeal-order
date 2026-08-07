"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { merchantToggleCheckAction } from "@/app/actions/onboarding";

// 점주 최하위 체크박스 — none(미체크) → pending(승인 대기) → approved(본사 승인=활성).
// 승인된 항목은 점주가 해제할 수 없다(본사만).
export function OnbCheck({
  nodeId,
  title,
  state,
}: {
  nodeId: string;
  title: string;
  state: "none" | "pending" | "approved";
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const click = () => {
    if (state === "approved") return;
    start(async () => {
      const res = await merchantToggleCheckAction({ nodeId, on: state === "none" });
      if (res.error) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  };

  const boxCls =
    state === "approved" ? "onbx--done" : state === "pending" ? "onbx--pending" : "onbx--none";

  return (
    <button
      type="button"
      className={`onbrow onbrow--leaf ${state === "approved" ? "is-approved" : ""}`}
      onClick={click}
      disabled={pending || state === "approved"}
    >
      <span className={`onbx ${boxCls}`} aria-hidden>
        {state === "approved" ? "✓" : ""}
      </span>
      <span className="onbrow__title">{title || "(제목 없음)"}</span>
      {state === "pending" && <span className="onbrow__tag onbrow__tag--wait">승인 대기</span>}
    </button>
  );
}
