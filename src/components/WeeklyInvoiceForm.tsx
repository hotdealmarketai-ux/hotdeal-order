"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  saveWeeklyInvoiceAction,
  type WeeklyInvoiceState,
} from "@/app/actions/weekly-invoice";
import { SubmitButton } from "./SubmitButton";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { WEEKLY_CATEGORIES } from "@/lib/weekly-catalog";
import type { WeeklyProductRow } from "@/lib/weekly";

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
  products,
}: {
  userId: string;
  date: string;
  initialItems: WeeklyInvoiceInitialItem[];
  products: WeeklyProductRow[];
}) {
  const uid = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    initialItems.map((it) => ({ id: ++uid.current, ...it })),
  );
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [state, formAction] = useActionState<WeeklyInvoiceState, FormData>(
    saveWeeklyInvoiceAction,
    {},
  );

  function updateRow(id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)));
  }
  function removeRow(id: number) {
    setConfirming(false);
    setRows((prev) => prev.filter((r) => r.id !== id));
  }
  function addProduct(p: WeeklyProductRow) {
    setRows((prev) => [
      ...prev,
      {
        id: ++uid.current,
        group: p.category,
        name: p.name,
        qty: "1",
        unitPrice: String(p.supplyPrice),
      },
    ]);
    setPicking(false);
  }

  const payload = useMemo(
    () =>
      rows.map((r) => ({
        group: r.group,
        name: r.name,
        qty: r.qty,
        unitPrice: r.unitPrice,
      })),
    [rows],
  );
  const total = rows.reduce((n, r) => n + rowAmount(r), 0);
  const cats = WEEKLY_CATEGORIES.filter((c) => rows.some((r) => r.group === c.key));

  function validate(): boolean {
    for (const r of rows) {
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
    if (rows.length === 0) {
      setLocalError("품목을 한 개 이상 넣어 주세요.");
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

      {cats.map((c) => {
        const list = rows.filter((r) => r.group === c.key);
        const sum = list.reduce((n, r) => n + rowAmount(r), 0);
        return (
          <div className="invcat" key={c.key}>
            <div className="invcat__head">
              <span className="chip">{c.label}</span>
              {sum > 0 && <span className="invcat__sum">{fmt(sum)}원</span>}
            </div>
            <div className="invcols" style={{ gridTemplateColumns: "1fr 60px 78px 66px 26px" }}>
              <span>품목</span>
              <span>수량</span>
              <span>단가</span>
              <span style={{ textAlign: "right" }}>금액</span>
              <span />
            </div>
            {list.map((r) => (
              <div
                className="invrow"
                key={r.id}
                style={{ gridTemplateColumns: "1fr 60px 78px 66px 26px" }}
              >
                <span className="wlname">{r.name}</span>
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
                <span className="invrow__amt">
                  {rowAmount(r) > 0 ? fmt(rowAmount(r)) : ""}
                </span>
                <button
                  type="button"
                  className="linkbtn linkbtn--danger"
                  onClick={() => removeRow(r.id)}
                  aria-label="삭제"
                  style={{ padding: 0 }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        );
      })}

      <button
        type="button"
        className="btn btn--soft btn--block"
        onClick={() => setPicking(true)}
        style={{ marginTop: 8 }}
      >
        + 품목 추가
      </button>

      <div className="invtotal" style={{ marginTop: 12 }}>
        <span>합계 · 자동 계산 ({rows.length}개)</span>
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
            <span>총 결제요청 금액 ({rows.length}개)</span>
            <b>{fmt(total)}원</b>
          </div>
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

      {/* 품목 추가 팝업 — 카탈로그에서만 선택(수기 입력 금지) */}
      {picking && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPicking(false);
          }}
        >
          <div className="sheet__panel">
            <div className="sheet__head">
              <div className="sheet__title">품목 추가</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={() => setPicking(false)}
              >
                ✕
              </button>
            </div>
            <p className="sheet__hint">주간발주 상품 목록에서 골라 추가하세요.</p>
            <div className="sheet__body">
              {WEEKLY_CATEGORIES.filter((c) =>
                products.some((p) => p.category === c.key),
              ).map((c) => (
                <div className="confsec" key={c.key}>
                  <div className="confsec__head">
                    <span className="chip">{c.label}</span>
                  </div>
                  {products
                    .filter((p) => p.category === c.key)
                    .map((p) => (
                      <button
                        type="button"
                        key={p.code}
                        className="wpick"
                        onClick={() => addProduct(p)}
                      >
                        <span>{p.name}</span>
                        <span className="wpick__price">{fmt(p.supplyPrice)}원</span>
                      </button>
                    ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
