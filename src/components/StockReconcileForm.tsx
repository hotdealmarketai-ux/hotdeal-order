"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyToolReconcileAdjusted,
  type ReconcileRow,
} from "@/app/actions/stock-reconcile";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 재고 정산 = '계산서(실제 출고) 기준' 차감 내역(읽기 전용). 차감은 계산서 발행 시 이미 일어났다.
// 혹시 발행 때 반영 안 된(미차감) 계산서가 있으면 '재고 반영'으로만 보정(멱등 — 이미 반영된 건 건너뜀, 이중차감 없음).
export function StockReconcileForm({
  date,
  rows,
  undeducted = 0,
}: {
  date: string;
  rows: ReconcileRow[];
  undeducted?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);

  const doApply = () =>
    start(async () => {
      const res = await applyToolReconcileAdjusted(date); // 미차감 계산서만 반영(멱등)
      setDone(res.count);
      router.refresh();
    });

  return (
    <>
      <div className="rectable rectable--record">
        <div className="rectable__head">
          <span className="rectable__name">품목</span>
          <span className="rectable__num">계산서(출고)</span>
          <span className="rectable__num">현재 재고</span>
        </div>
        {rows.map((r) => (
          <div
            className={`rectable__row${!r.matched ? " rectable__row--warn" : ""}`}
            key={r.name}
          >
            <span className="rectable__name">
              {r.name}
              {!r.matched && <span className="rectable__warn">재고없음</span>}
            </span>
            <span className="rectable__num">{fmt(r.tool)}</span>
            <span className="rectable__num">{r.matched ? fmt(r.base) : "—"}</span>
          </div>
        ))}
      </div>

      {done !== null ? (
        <div className="notice notice--ok" style={{ marginTop: 16 }}>
          ✓ 미차감 계산서 {done}건을 재고에 반영했어요.
        </div>
      ) : undeducted > 0 ? (
        <div className="card" style={{ marginTop: 16 }}>
          <p className="row__sub" style={{ marginBottom: 10 }}>
            발행됐지만 아직 재고에 반영 안 된 계산서가 {undeducted}건 있어요. 지금 반영할까요?
            (이미 반영된 계산서는 건너뛰어 이중 차감되지 않아요.)
          </p>
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={pending}
            onClick={doApply}
          >
            {pending ? "반영 중…" : `미차감 ${undeducted}건 재고 반영`}
          </button>
        </div>
      ) : (
        <div className="notice notice--mute" style={{ marginTop: 16 }}>
          이 출고일 계산서 공구는 발행 시 모두 재고에 반영됐어요. (여기서 추가로 빠지지 않아요)
        </div>
      )}
    </>
  );
}
