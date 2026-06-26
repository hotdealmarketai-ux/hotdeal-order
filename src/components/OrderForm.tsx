"use client";

import { useActionState, useRef, useState } from "react";
import { createOrderAction, type OrderFormState } from "@/app/actions/order";
import { SubmitButton } from "./SubmitButton";
import { CATEGORIES, type Category } from "@/lib/constants";

type Row = { id: number; name: string; qty: string; note: string };

export function OrderForm({
  categories,
  needsPickup,
}: {
  categories: Category[];
  needsPickup: boolean;
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", note: "" });

  const [active, setActive] = useState<Category>(categories[0]);
  const [rowsByCat, setRowsByCat] = useState<Record<string, Row[]>>(() => {
    const init: Record<string, Row[]> = {};
    for (const c of categories) init[c] = [newRow()];
    return init;
  });
  const [pickup, setPickup] = useState("");
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    createOrderAction,
    {},
  );

  const rows = rowsByCat[active] ?? [];

  function withTrailingEmpty(list: Row[]): Row[] {
    const last = list[list.length - 1];
    if (!last || last.name || last.qty || last.note) return [...list, newRow()];
    return list;
  }

  function updateRow(id: number, field: keyof Row, value: string) {
    setRowsByCat((prev) => {
      const list = prev[active].map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      return { ...prev, [active]: withTrailingEmpty(list) };
    });
  }

  function removeRow(id: number) {
    setRowsByCat((prev) => {
      let list = prev[active].filter((r) => r.id !== id);
      if (list.length === 0) list = [newRow()];
      return { ...prev, [active]: withTrailingEmpty(list) };
    });
  }

  const itemsForSubmit = rows
    .filter((r) => r.name.trim() || r.qty.trim() || r.note.trim())
    .map((r) => ({ name: r.name, qty: r.qty, note: r.note }));

  const cat = CATEGORIES[active];

  return (
    <form action={formAction}>
      <input type="hidden" name="category" value={active} />
      <input type="hidden" name="items" value={JSON.stringify(itemsForSubmit)} />
      {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}

      {state?.error && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state.error}
        </div>
      )}

      {categories.length > 1 && (
        <div className="cattabs">
          {categories.map((c) => (
            <button
              type="button"
              key={c}
              className={`cattab ${active === c ? "is-active" : ""}`}
              onClick={() => setActive(c)}
            >
              <span aria-hidden>{CATEGORIES[c].icon}</span>
              {CATEGORIES[c].label}
            </button>
          ))}
        </div>
      )}

      <div className="notice notice--info" style={{ marginBottom: 14 }}>
        받는 곳 · <b>{cat.vendorLabel}</b> &nbsp;({cat.desc})
      </div>

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
            placeholder="예) 오전 7시 / 8시 30분"
          />
        </div>
      )}

      <div className="section-label">발주 품목</div>

      {rows.map((r, i) => {
        const filled = !!(r.name || r.qty || r.note);
        return (
          <div className="orderline" key={r.id}>
            <div className="orderline__idx">
              <span className="orderline__num">{i + 1}</span>
              {filled && (
                <button
                  type="button"
                  className="linkbtn linkbtn--danger"
                  onClick={() => removeRow(r.id)}
                >
                  삭제
                </button>
              )}
            </div>
            <input
              className="input orderline__name"
              value={r.name}
              onChange={(e) => updateRow(r.id, "name", e.target.value)}
              placeholder="품목 (예: 사과)"
            />
            <input
              className="input"
              value={r.qty}
              onChange={(e) => updateRow(r.id, "qty", e.target.value)}
              placeholder="수량"
            />
            <input
              className="input orderline__note"
              value={r.note}
              onChange={(e) => updateRow(r.id, "note", e.target.value)}
              placeholder="부연설명 (등급·다이·요청 등)"
            />
          </div>
        );
      })}

      <p className="hint">칸을 채우면 다음 줄이 자동으로 생겨요. 필요한 만큼 적으세요.</p>

      <div style={{ marginTop: 18 }}>
        <SubmitButton pendingText="AI가 정리 중…">발주하기</SubmitButton>
      </div>
    </form>
  );
}
