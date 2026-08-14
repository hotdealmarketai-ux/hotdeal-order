"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  saveChaeumchaeProductsAction,
  type ChaeumchaeProductState,
} from "@/app/actions/chaeumchae-products";
import { SubmitButton } from "./SubmitButton";
import { MoneyInput } from "./MoneyInput";
import { TaxToggle } from "./TaxToggle";
import type { ChaeumchaeProductRow } from "@/lib/chaeumchae-products";

type Row = {
  key: string;
  id: string | null;
  seq: string;
  name: string;
  hasBox: boolean;
  perBox: string;
  piecePrice: string;
  unit: string;
  tax: string;
  deleted: boolean;
};

// 채움채 상품관리 — 박스입수·낱개단가·단위·과세면세. 발주는 박스, 계산서엔 낱개(박스수×입수)로 환산.
export function ChaeumchaeProductForm({ initial }: { initial: ChaeumchaeProductRow[] }) {
  const uid = useRef(0);
  const [rows, setRows] = useState<Row[]>(() =>
    initial.map((p) => ({
      key: `c${uid.current++}`,
      id: p.id,
      seq: p.seq,
      name: p.name,
      hasBox: p.hasBox,
      perBox: String(p.perBox),
      piecePrice: String(p.piecePrice),
      unit: p.unit || "개",
      tax: p.tax ?? "",
      deleted: false,
    })),
  );
  const [state, formAction] = useActionState<ChaeumchaeProductState, FormData>(
    saveChaeumchaeProductsAction,
    {},
  );

  function update(key: string, field: keyof Row, value: string | boolean) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function remove(key: string) {
    setRows((prev) =>
      prev
        .map((r) => (r.key === key ? { ...r, deleted: true } : r))
        .filter((r) => !(r.deleted && !r.id)),
    );
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      {
        key: `c${uid.current++}`,
        id: null,
        seq: "",
        name: "",
        hasBox: true,
        perBox: "1",
        piecePrice: "0",
        unit: "개",
        tax: "",
        deleted: false,
      },
    ]);
  }

  const payload = useMemo(
    () =>
      rows.map((r) => ({
        id: r.id,
        seq: r.seq,
        name: r.name,
        hasBox: r.hasBox,
        perBox: r.perBox,
        piecePrice: r.piecePrice,
        unit: r.unit,
        tax: r.tax,
        deleted: r.deleted,
      })),
    [rows],
  );
  const shown = rows.filter((r) => !r.deleted);

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {state?.ok && (
        <div className="notice notice--ok" style={{ marginBottom: 12 }}>
          저장했어요.
        </div>
      )}

      <div className="itemshead">
        <span className="itemshead__label">채움채 상품</span>
        <span className="itemshead__count">{shown.length}개</span>
      </div>
      <p className="hint" style={{ margin: "0 0 10px" }}>
        발주는 박스 단위, 계산서엔 낱개로 환산됩니다 — 낱개수량 = 박스수 × 낱개입수, 단가 = 낱개단가.
      </p>

      {shown.map((r) => (
        <div className="wprow" key={r.key}>
          <input
            className="input wprow__name"
            value={r.name}
            onChange={(e) => update(r.key, "name", e.target.value)}
            placeholder="품목명"
          />
          <div className="wprow__nums">
            {/* 박스 여부 — 순두부처럼 박스 없이 낱개로 발주하는 품목은 '낱개' */}
            <span className="ccseg" role="group" aria-label="발주 단위">
              <button
                type="button"
                className={`ccseg__b${r.hasBox ? " is-on" : ""}`}
                onClick={() => update(r.key, "hasBox", true)}
              >
                박스
              </button>
              <button
                type="button"
                className={`ccseg__b${!r.hasBox ? " is-on" : ""}`}
                onClick={() => update(r.key, "hasBox", false)}
              >
                낱개
              </button>
            </span>
            {r.hasBox && (
              <span className="wprow__field">
                1박스{" "}
                <input
                  className="input"
                  inputMode="numeric"
                  value={r.perBox}
                  onChange={(e) => update(r.key, "perBox", e.target.value)}
                />{" "}
                {r.unit}입
              </span>
            )}
            <span className="wprow__field">
              낱개단가{" "}
              <MoneyInput
                value={r.piecePrice}
                onChange={(raw) => update(r.key, "piecePrice", raw)}
              />{" "}
              원
            </span>
            <span className="wprow__field">
              단위{" "}
              <input
                className="input"
                style={{ width: 46 }}
                value={r.unit}
                onChange={(e) => update(r.key, "unit", e.target.value)}
                placeholder="개"
              />
            </span>
            <span className="wprow__field wprow__field--tax">
              <TaxToggle value={r.tax} onChange={(v) => update(r.key, "tax", v)} />
            </span>
            <button
              type="button"
              className="linkbtn linkbtn--danger"
              onClick={() => remove(r.key)}
            >
              삭제
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn--soft btn--block"
        onClick={addRow}
        style={{ marginTop: 10 }}
      >
        + 상품 추가
      </button>

      <div className="ctabar">
        <SubmitButton className="btn btn--primary btn--block" pendingText="저장 중…">
          저장
        </SubmitButton>
      </div>
    </form>
  );
}
