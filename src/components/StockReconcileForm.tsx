"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  applyToolReconcileAdjusted,
  type ReconcileRow,
} from "@/app/actions/stock-reconcile";

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 재고 마감 = 계산서 기준 출고(차감) 내역. 수량은 기본 잠금 — 품목별 '수정'을 눌러야 편집(오조작 방지).
// 수정 후 '재고 반영'을 누르면 그 차이만큼 기준재고를 재조정(멱등). 재고현황에 없는 품목은 아래 따로 표시.
export function StockReconcileForm({
  date,
  matched,
  unmatched,
  undeducted = 0,
}: {
  date: string;
  matched: ReconcileRow[];
  unmatched: { name: string; invoiceTotal: number }[];
  undeducted?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [done, setDone] = useState<number | null>(null);
  const [editing, setEditing] = useState<Set<string>>(new Set());
  const [vals, setVals] = useState<Record<string, string>>({});

  const unlock = (name: string, cur: number) => {
    setDone(null); // 성공 메시지 뒤에도 재수정 가능하게(전체 새로고침 불필요)
    setEditing((s) => new Set(s).add(name));
    setVals((v) => (v[name] === undefined ? { ...v, [name]: String(cur) } : v));
  };
  // 출고량은 정수. 자릿수 캡(6자리)으로 오타성 거대값 방지(서버도 재고량으로 캡).
  const setVal = (name: string, v: string) =>
    setVals((prev) => ({ ...prev, [name]: v.replace(/[^\d]/g, "").slice(0, 6) }));

  const apply = () =>
    start(async () => {
      const edits = [...editing].map((name) => ({
        name,
        qty: parseInt(vals[name] || "0", 10) || 0,
      }));
      const res = await applyToolReconcileAdjusted(date, edits);
      setDone(res.count);
      setEditing(new Set());
      router.refresh();
    });

  const hasEdits = editing.size > 0;

  return (
    <>
      {/* 차감 목록 — 재고현황에 있는 품목(수량 기본 잠금, 품목별 수정) */}
      {matched.length === 0 ? (
        <div className="empty">
          <p>이 출고일에 발행된 계산서 공구가 없어요.</p>
        </div>
      ) : (
        <div className="rectable rectable--record">
          <div className="rectable__head">
            <span className="rectable__name">품목</span>
            <span className="rectable__num">출고(차감)</span>
            <span className="rectable__num">현재재고</span>
            <span className="rectable__num" />
          </div>
          {matched.map((r) => {
            const editingThis = editing.has(r.name);
            return (
              <div className="rectable__row" key={r.name}>
                <span className="rectable__name">
                  {r.name}
                  {r.adjusted && <span className="rectable__adj">조정됨</span>}
                </span>
                {editingThis ? (
                  <input
                    className="rectable__input"
                    inputMode="numeric"
                    value={vals[r.name] ?? String(r.deducted)}
                    onChange={(e) => setVal(r.name, e.target.value)}
                    aria-label={`${r.name} 출고량`}
                    autoFocus
                  />
                ) : (
                  <span className="rectable__num">{fmt(r.deducted)}</span>
                )}
                <span className="rectable__num">{fmt(r.base)}</span>
                <span className="rectable__num rectable__num--act">
                  {!editingThis && (
                    <button
                      type="button"
                      className="rectable__edit"
                      onClick={() => unlock(r.name, r.deducted)}
                    >
                      수정
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {done !== null ? (
        <div className="notice notice--ok" style={{ marginTop: 16 }}>
          ✓ 저장했어요.{" "}
          {done > 0
            ? `${done}품목 수량을 조정해 재고에 반영했어요.`
            : "변경사항이 재고에 반영됐어요."}
        </div>
      ) : (
        (hasEdits || undeducted > 0) && (
          <button
            type="button"
            className="btn btn--primary btn--block"
            style={{ marginTop: 16 }}
            disabled={pending}
            onClick={apply}
          >
            {pending
              ? "적용 중…"
              : hasEdits
                ? `수정한 수량 재고 반영 (${editing.size}품목)`
                : `미차감 ${undeducted}건 재고 반영`}
          </button>
        )
      )}

      {/* 재고현황에 없어 차감 안 된 품목 — 따로 필터링해 표시 */}
      {unmatched.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="section-label" style={{ color: "var(--danger)" }}>
            차감 안 됨 — 재고현황에 없는 품목 ({unmatched.length})
          </div>
          <div className="rectable rectable--record2">
            <div className="rectable__head">
              <span className="rectable__name">품목</span>
              <span className="rectable__num">계산서 출고</span>
            </div>
            {unmatched.map((u) => (
              <div className="rectable__row rectable__row--warn" key={u.name}>
                <span className="rectable__name">{u.name}</span>
                <span className="rectable__num">{fmt(u.invoiceTotal)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
