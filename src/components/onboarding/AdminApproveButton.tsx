"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminApproveAction } from "@/app/actions/onboarding";

// 관리자 승인 토글 — 점주가 누른(승인 대기) 항목을 승인/해제.
export function AdminApproveButton({
  userId,
  nodeId,
  approved,
}: {
  userId: string;
  nodeId: string;
  approved: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const toggle = () =>
    start(async () => {
      const res = await adminApproveAction({ userId, nodeId, approve: !approved });
      if (res.error) {
        alert(res.error);
        return;
      }
      router.refresh();
    });
  return (
    <button
      type="button"
      className={`btn btn--xs ${approved ? "btn--soft" : "btn--primary"}`}
      onClick={toggle}
      disabled={pending}
    >
      {pending ? "…" : approved ? "승인 해제" : "승인"}
    </button>
  );
}
