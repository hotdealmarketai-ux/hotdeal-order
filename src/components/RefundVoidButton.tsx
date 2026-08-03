"use client";

import { useTransition } from "react";
import { voidRefundAction } from "@/app/actions/refund";

// 환불계산서 취소 — 확인 후 서버 액션(voidRefundAction) 호출. 차감했던 미수가 복구된다.
export function RefundVoidButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn--sm btn--ghost"
      disabled={pending}
      onClick={() => {
        if (!confirm("이 환불계산서를 취소할까요?\n차감했던 미수가 다시 복구됩니다.")) return;
        const fd = new FormData();
        fd.set("id", id);
        start(() => voidRefundAction(fd));
      }}
    >
      {pending ? "취소 중…" : "환불 취소"}
    </button>
  );
}
