"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { updateOrderAction, type OrderFormState } from "@/app/actions/order";
import { SubmitButton } from "./SubmitButton";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import type { Category } from "@/lib/constants";

type Row = { id: number; name: string; qty: string; note: string };

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.note.trim());
}

export function EditOrderForm({
  orderId,
  category,
  receiver,
  initialItems,
  needsPickup,
  initialPickup,
}: {
  orderId: string;
  category: Category;
  receiver: string;
  initialItems: { name: string; qty: string; note: string }[];
  needsPickup: boolean;
  initialPickup?: string;
}) {
  const isTofu = category === "TOFU";
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", note: "" });

  const [rows, setRows] = useState<Row[]>(() => {
    const seed = initialItems.map((it) => ({
      id: ++uid.current,
      name: it.name,
      qty: it.qty,
      note: it.note,
    }));
    return [...seed, newRow()];
  });
  // 채움채(두부류): 체크리스트 수량 (기존 발주에서 채워 넣음)
  const [tofuQty, setTofuQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of initialItems) {
      const p = CHAEUMCHAE_CATALOG.find((c) => c.name === it.name.trim());
      if (p) m[p.seq] = it.qty;
    }
    return m;
  });
  const [pickup, setPickup] = useState(initialPickup ?? "");
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    updateOrderAction,
    {},
  );

  function withTrailingEmpty(list: Row[]): Row[] {
    const last = list[list.length - 1];
    if (!last || last.name || last.qty || last.note) return [...list, newRow()];
    return list;
  }

  function updateRow(id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRows((prev) =>
      withTrailingEmpty(
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
      ),
    );
  }

  function removeRow(id: number) {
    setRows((prev) => {
      let list = prev.filter((r) => r.id !== id);
      if (list.length === 0) list = [newRow()];
      return withTrailingEmpty(list);
    });
  }

  const items = useMemo(() => {
    if (isTofu) {
      return CHAEUMCHAE_CATALOG.filter((p) => (tofuQty[p.seq] ?? "").trim()).map(
        (p) => ({ name: p.name, qty: tofuQty[p.seq].trim(), note: "" }),
      );
    }
    return rows
      .filter(isFilled)
      .map((r) => ({ name: r.name, qty: r.qty, note: r.note }));
  }, [isTofu, rows, tofuQty]);

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      {needsPickup && (
        <div className="field">
          <label className="label" htmlFor="pickup">
            픽업 시간
          </label>
          <input
            id="pickup"
            className="input"
            value={pickup}
            onChange={(e) => setPickup(e.target.value)}
            placeholder="오전 7시 30분"
          />
        </div>
      )}

      <div className="itemshead">
        <span className="itemshead__label">발주 품목 · {receiver}</span>
        <span className="itemshead__count">{items.length}건</span>
      </div>

      {isTofu ? (
        <div className="tofulist">
          {CHAEUMCHAE_CATALOG.map((p) => {
            const q = tofuQty[p.seq] ?? "";
            return (
              <div className={`tofuitem ${q.trim() ? "is-on" : ""}`} key={p.seq}>
                <span className="tofuitem__name">{p.name}</span>
                <input
                  className="input tofuitem__qty"
                  inputMode="numeric"
                  value={q}
                  onChange={(e) => {
                    setConfirming(false);
                    setTofuQty((prev) => ({ ...prev, [p.seq]: e.target.value }));
                  }}
                  placeholder="수량"
                />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="oitems">
          {rows.map((r, i) => {
            const filled = isFilled(r);
            return (
              <div className={`oitem ${filled ? "is-filled" : ""}`} key={r.id}>
                <span className="oitem__num">{String(i + 1).padStart(2, "0")}</span>
                <div className="oitem__fields">
                  <div className="oitem__row1">
                    <input
                      className="input"
                      value={r.name}
                      onChange={(e) => updateRow(r.id, "name", e.target.value)}
                      placeholder="품목"
                    />
                    <input
                      className="input"
                      value={r.qty}
                      onChange={(e) => updateRow(r.id, "qty", e.target.value)}
                      placeholder="수량"
                    />
                  </div>
                  <input
                    className="input"
                    value={r.note}
                    onChange={(e) => updateRow(r.id, "note", e.target.value)}
                    placeholder="설명"
                  />
                </div>
                {filled && (
                  <button
                    type="button"
                    className="oitem__del"
                    onClick={() => removeRow(r.id)}
                  >
                    삭제
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {!confirming ? (
        <div className="ctabar">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              if (items.length === 0) {
                setLocalError("발주할 품목을 한 개 이상 입력하세요.");
                return;
              }
              setLocalError("");
              setConfirming(true);
            }}
          >
            수정 완료{items.length > 0 ? ` · ${items.length}건` : ""}
          </button>
        </div>
      ) : (
        <div className="confirm">
          <div className="confirm__title">이대로 수정할까요?</div>
          <p className="confirm__hint">
            수정하면 발주 받는 곳에 &lsquo;발주 수정&rsquo;으로 다시 표시됩니다.
          </p>
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(false)}
            >
              다시 볼게요
            </button>
            <SubmitButton pendingText="저장 중…">네, 수정할게요</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}
