"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  saveWeeklyInvoiceAction,
  type WeeklyInvoiceState,
} from "@/app/actions/weekly-invoice";
import { SubmitButton } from "./SubmitButton";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";

type Row = {
  id: number;
  group: string;
  name: string;
  qty: string;
  unitPrice: string;
};

export type WeeklyInvoiceInitialItem = {
  group: string;
  name: string;
  qty: string;
  unitPrice: string;
};

const fmt = (n: number) => n.toLocaleString("ko-KR");

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());
}
function rowAmount(r: Row): number {
  const qty = parseQtyStrict(r.qty);
  const price = parsePriceStrict(r.unitPrice);
  if (qty == null || price == null) return 0;
  return Math.round(qty * price);
}

export function WeeklyInvoiceForm({
  userId,
  date,
  initialItems,
}: {
  userId: string;
  date: string;
  initialItems: WeeklyInvoiceInitialItem[];
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({
    id: ++uid.current,
    group: "WEEKLY",
    name: "",
    qty: "",
    unitPrice: "",
  });

  const [rows, setRows] = useState<Row[]>(() => {
    const init = initialItems.map((it) => ({ id: ++uid.current, ...it }));
    return [...init, newRow()];
  });
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [state, formAction] = useActionState<WeeklyInvoiceState, FormData>(
    saveWeeklyInvoiceAction,
    {},
  );

  function updateRow(id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRows((prev) => {
      const list = prev.map((r) => (r.id === id ? { ...r, [field]: value } : r));
      const last = list[list.length - 1];
      return !last || isFilled(last) ? [...list, newRow()] : list;
    });
  }
  function removeRow(id: number) {
    setConfirming(false);
    setRows((prev) => {
      const list = prev.filter((r) => r.id !== id);
      return list.length ? list : [newRow()];
    });
  }

  const filled = rows.filter(isFilled);
  const payload = useMemo(
    () =>
      filled.map((r) => ({
        group: r.group,
        name: r.name,
        qty: r.qty,
        unitPrice: r.unitPrice,
      })),
    [filled],
  );
  const total = filled.reduce((n, r) => n + rowAmount(r), 0);

  function validate(): boolean {
    for (const r of filled) {
      if (!r.name.trim()) {
        setLocalError("품목명이 비어 있는 줄이 있어요.");
        return false;
      }
      if (parseQtyStrict(r.qty) == null) {
        setLocalError(`'${r.name}' 수량을 확인해 주세요.`);
        return false;
      }
      if (parsePriceStrict(r.unitPrice) == null) {
        setLocalError(`'${r.name}' 단가를 확인해 주세요.`);
        return false;
      }
    }
    if (filled.length === 0) {
      setLocalError("품목을 한 개 이상 입력하세요.");
      return false;
    }
    setLocalError("");
    return true;
  }

  return (
    <form
      action={formAction}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="date" value={date} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      <p className="lead" style={{ marginTop: 0 }}>
        점주 주간발주를 그대로 불러왔어요. 다르게 나가는 품목만 수정·삭제하고 발행하세요.
      </p>

      <div className="invcat">
        <div className="invcols" style={{ gridTemplateColumns: "1fr 62px 80px 70px 30px" }}>
          <span>품목</span>
          <span>수량</span>
          <span>단가</span>
          <span style={{ textAlign: "right" }}>금액</span>
          <span />
        </div>
        {rows.map((r) => {
          const amt = rowAmount(r);
          return (
            <div
              className="invrow"
              key={r.id}
              style={{ gridTemplateColumns: "1fr 62px 80px 70px 30px" }}
            >
              <input
                className="input"
                value={r.name}
                onChange={(e) => updateRow(r.id, "name", e.target.value)}
                placeholder="품목"
              />
              <input
                className="input"
                inputMode="decimal"
                value={r.qty}
                onChange={(e) => updateRow(r.id, "qty", e.target.value)}
                placeholder="수량"
              />
              <input
                className="input"
                inputMode="numeric"
                value={r.unitPrice}
                onChange={(e) => updateRow(r.id, "unitPrice", e.target.value)}
                placeholder="단가"
              />
              <span className="invrow__amt">{amt > 0 ? fmt(amt) : ""}</span>
              {isFilled(r) ? (
                <button
                  type="button"
                  className="linkbtn linkbtn--danger"
                  onClick={() => removeRow(r.id)}
                  aria-label="삭제"
                  style={{ padding: 0 }}
                >
                  ✕
                </button>
              ) : (
                <span />
              )}
            </div>
          );
        })}
      </div>

      <div className="invtotal">
        <span>합계 · 자동 계산 ({filled.length}건)</span>
        <b>{fmt(total)}원</b>
      </div>

      {!confirming ? (
        <div className="confirm__actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              if (validate()) setConfirming(true);
            }}
          >
            입금요청서 발행하기
          </button>
        </div>
      ) : (
        <div className="confirm">
          <div className="confirm__title">이대로 발행할까요?</div>
          <div className="invtotal" style={{ marginTop: 4 }}>
            <span>총 결제요청 금액 ({filled.length}건)</span>
            <b>{fmt(total)}원</b>
          </div>
          <p className="confirm__hint">
            발행하면 점주에게 &lsquo;주간발주 입금요청서&rsquo; 알림이 가요.
          </p>
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(false)}
            >
              다시 볼게요
            </button>
            <SubmitButton pendingText="발행 중…">네, 발행할게요</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}
