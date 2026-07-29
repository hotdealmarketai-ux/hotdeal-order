"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { applyToolReconcile } from "@/app/actions/stock-reconcile";

// 정산 적용 — 파괴적(기준재고 차감)이라 확인 스텝을 한 번 둔다. 멱등이라 재실행해도 재차감 없음.
export function StockReconcileApply({
  date,
  count,
}: {
  date: string;
  count: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<number | null>(null);

  if (count === 0) return null;

  if (done !== null) {
    return (
      <div className="notice notice--ok" style={{ marginTop: 16 }}>
        ✓ {done}건 정산 완료 — 기준재고에 반영했어요. 실제 출고량이 다르면 재고현황에서 수기 보정하세요.
      </div>
    );
  }

  if (!confirm) {
    return (
      <button
        type="button"
        className="btn btn--primary btn--block"
        style={{ marginTop: 16 }}
        onClick={() => setConfirm(true)}
      >
        이대로 기준재고 차감 적용 ({count}건)
      </button>
    );
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <p className="row__sub" style={{ marginBottom: 10 }}>
        위 ‘제안재고’ 대로 기준재고를 차감합니다. 되돌리려면 재고현황에서 수기 수정하세요. 진행할까요?
      </p>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={pending}
          onClick={() => setConfirm(false)}
        >
          취소
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await applyToolReconcile(date);
              setDone(res.count);
              router.refresh();
            })
          }
        >
          {pending ? "적용 중…" : "차감 적용"}
        </button>
      </div>
    </div>
  );
}
