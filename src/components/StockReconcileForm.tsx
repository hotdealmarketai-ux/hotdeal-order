"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyToolReconcileAdjusted,
  type ReconcileRow,
} from "@/app/actions/stock-reconcile";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 재고 정산 미리보기 — 차감량을 직접 수정 가능(추가 불출 등 실제 나간 만큼). 제안재고 실시간 재계산.
export function StockReconcileForm({
  date,
  rows,
}: {
  date: string;
  rows: ReconcileRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  // 품목별 차감량(문자, 기본=발주합계) — 수정 가능
  const [amt, setAmt] = useState<Record<string, string>>(() =>
    Object.fromEntries(rows.map((r) => [r.name, String(r.ordered)])),
  );
  const set = (name: string, v: string) =>
    setAmt((a) => ({ ...a, [name]: v.replace(/[^\d]/g, "") }));
  const qtyOf = (name: string) => parseInt(amt[name] || "0", 10) || 0;

  if (done !== null) {
    return (
      <div className="notice notice--ok" style={{ marginTop: 16 }}>
        ✓ {done}건 정산 완료 — 기준재고에 반영했어요. 실제와 다르면 재고현황에서 수기 보정하세요.
      </div>
    );
  }

  const doApply = () =>
    start(async () => {
      const adjustments = rows
        .filter((r) => r.matched)
        .map((r) => ({ name: r.name, qty: qtyOf(r.name) }));
      const res = await applyToolReconcileAdjusted(date, adjustments);
      setDone(res.count);
      router.refresh();
    });

  return (
    <>
      <div className="rectable rectable--edit">
        <div className="rectable__head">
          <span className="rectable__name">품목</span>
          <span className="rectable__num">발주(수정)</span>
          <span className="rectable__num">현재</span>
          <span className="rectable__num">→제안</span>
        </div>
        {rows.map((r) => {
          const proposed = Math.max(0, r.base - qtyOf(r.name));
          const over = r.matched && qtyOf(r.name) > r.ordered;
          return (
            <div
              className={`rectable__row${!r.matched ? " rectable__row--warn" : ""}`}
              key={r.name}
            >
              <span className="rectable__name">
                {r.name}
                {r.resv > 0 && (
                  <span className="rectable__resv">예약 {fmt(r.resv)}</span>
                )}
                {!r.matched && <span className="rectable__warn">재고없음</span>}
              </span>
              {r.matched ? (
                <input
                  className={`rectable__input${over ? " is-over" : ""}`}
                  inputMode="numeric"
                  value={amt[r.name] ?? ""}
                  onChange={(e) => set(r.name, e.target.value)}
                  aria-label={`${r.name} 발주(차감)량`}
                />
              ) : (
                <span className="rectable__num">{fmt(r.ordered)}</span>
              )}
              <span className="rectable__num">{r.matched ? fmt(r.base) : "—"}</span>
              <span className="rectable__num rectable__num--to">
                {r.matched ? fmt(proposed) : "—"}
              </span>
            </div>
          );
        })}
      </div>

      {done === null &&
        (!confirm ? (
          <button
            type="button"
            className="btn btn--primary btn--block"
            style={{ marginTop: 16 }}
            onClick={() => setConfirm(true)}
          >
            이대로 기준재고 차감 적용 ({rows.filter((r) => r.matched).length}개 품목)
          </button>
        ) : (
          <div className="card" style={{ marginTop: 16 }}>
            <p className="row__sub" style={{ marginBottom: 10 }}>
              위 ‘차감량’ 대로 기준재고를 차감합니다. 되돌리려면 재고현황에서 수기 수정하세요. 진행할까요?
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
                onClick={doApply}
              >
                {pending ? "적용 중…" : "차감 적용"}
              </button>
            </div>
          </div>
        ))}
    </>
  );
}
