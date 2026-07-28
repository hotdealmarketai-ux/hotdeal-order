"use client";

import { deleteInvoiceDraftAction } from "@/app/actions/invoice";

// 작성중(DRAFT) 계산서 삭제 — 발행 전 초안만. 확인 후 삭제(되돌릴 수 없음).
export function DeleteDraftButton({ invoiceId }: { invoiceId: string }) {
  return (
    <form
      action={deleteInvoiceDraftAction}
      onSubmit={(e) => {
        if (!window.confirm("이 작성중 계산서를 삭제할까요? 되돌릴 수 없어요.")) {
          e.preventDefault();
        }
      }}
      style={{ marginTop: 14 }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <button
        type="submit"
        className="btn btn--ghost btn--block"
        style={{ color: "var(--danger)" }}
      >
        작성중 계산서 삭제
      </button>
    </form>
  );
}
