"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  saveInvoiceAction,
  deleteInvoiceDraftAction,
  type InvoiceFormState,
} from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";
import { CATEGORIES, type Category } from "@/lib/constants";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";

type Row = { id: number; name: string; qty: string; unitPrice: string };

export type InvoiceInitialItem = {
  category: Category;
  name: string;
  qty: string;
  unitPrice: string;
};

export type InvoiceRefGroup = {
  category: Category;
  items: { name: string; qty: string; note: string }[];
};

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());
}

// 서버(cleanItems)와 동일한 엄격 파싱 — 형식이 아니면 금액을 아예 표시하지 않는다
function rowAmount(r: Row): number {
  const qty = parseQtyStrict(r.qty);
  const price = parsePriceStrict(r.unitPrice);
  if (qty == null || price == null) return 0;
  return Math.round(qty * price);
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

function DraftSaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="mode"
      value="draft"
      className="btn btn--ghost"
      disabled={pending}
    >
      {pending ? "저장 중…" : "임시저장"}
    </button>
  );
}

export function InvoiceForm({
  invoiceId,
  userId,
  date,
  categories,
  initialItems = [],
  initialMemo = "",
  refGroups = [],
}: {
  invoiceId?: string;
  userId: string;
  date: string;
  categories: Category[];
  initialItems?: InvoiceInitialItem[];
  initialMemo?: string;
  refGroups?: InvoiceRefGroup[];
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({
    id: ++uid.current,
    name: "",
    qty: "",
    unitPrice: "",
  });

  const [rowsByCat, setRowsByCat] = useState<Record<string, Row[]>>(() => {
    const init: Record<string, Row[]> = {};
    for (const c of categories) init[c] = [];
    for (const it of initialItems) {
      if (!init[it.category]) continue;
      init[it.category].push({
        id: ++uid.current,
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
      });
    }
    for (const c of categories) init[c].push(newRow());
    return init;
  });
  const [memo, setMemo] = useState(initialMemo);
  const [confirming, setConfirming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [localError, setLocalError] = useState("");
  const [state, formAction] = useActionState<InvoiceFormState, FormData>(
    saveInvoiceAction,
    {},
  );

  function updateRow(cat: Category, id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[cat].map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      const last = list[list.length - 1];
      const next = !last || isFilled(last) ? [...list, newRow()] : list;
      return { ...prev, [cat]: next };
    });
  }

  // payload: 카테고리 순서 그대로, 채워진 줄만
  const payload = useMemo(
    () =>
      categories.flatMap((c) =>
        (rowsByCat[c] ?? [])
          .filter(isFilled)
          .map((r) => ({
            category: c,
            name: r.name,
            qty: r.qty,
            unitPrice: r.unitPrice,
          })),
      ),
    [categories, rowsByCat],
  );

  const subtotals = useMemo(() => {
    const m: Record<string, { count: number; sum: number }> = {};
    for (const c of categories) {
      const rows = (rowsByCat[c] ?? []).filter(isFilled);
      m[c] = {
        count: rows.length,
        sum: rows.reduce((n, r) => n + rowAmount(r), 0),
      };
    }
    return m;
  }, [categories, rowsByCat]);

  const total = categories.reduce((n, c) => n + (subtotals[c]?.sum ?? 0), 0);
  const totalCount = categories.reduce(
    (n, c) => n + (subtotals[c]?.count ?? 0),
    0,
  );

  // 발행 전 검증 — 서버(cleanItems)와 동일 규칙
  function validate(): boolean {
    for (const c of categories) {
      for (const r of (rowsByCat[c] ?? []).filter(isFilled)) {
        if (!r.name.trim()) {
          setLocalError("품목명이 비어 있는 줄이 있어요.");
          return false;
        }
        if (parseQtyStrict(r.qty) == null) {
          setLocalError(`'${r.name}' 수량을 확인해 주세요. (숫자만, 예: 4 또는 0.5)`);
          return false;
        }
        if (parsePriceStrict(r.unitPrice) == null) {
          setLocalError(`'${r.name}' 단가를 확인해 주세요. (원 단위 숫자만)`);
          return false;
        }
      }
    }
    if (totalCount === 0) {
      setLocalError("품목을 한 개 이상 입력하세요.");
      return false;
    }
    setLocalError("");
    return true;
  }

  const refCount = refGroups.reduce((n, g) => n + g.items.length, 0);

  return (
    <>
      <form
        action={formAction}
        onKeyDown={(e) => {
          // 입력칸에서 Enter로 폼이 제출(=발행)되는 사고 방지 — 버튼으로만 제출
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName === "INPUT"
          ) {
            e.preventDefault();
          }
        }}
      >
        {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="payload" value={JSON.stringify(payload)} />

        {(state?.error || localError) && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            {state?.error || localError}
          </div>
        )}

        <div className="notice notice--info" style={{ marginBottom: 14 }}>
          발주 내역은 참고만 하세요 — <b>실제 출고 기준</b>으로 직접
          입력합니다. (더 나간 것·빠진 것·주문 없던 것 모두 반영)
        </div>

        {refCount > 0 && (
          <details className="invref">
            <summary>이날 발주 내역 참고 ({refCount}건)</summary>
            <div className="invref__body">
              {refGroups.map((g) => (
                <div key={g.category} className="invref__group">
                  <span className="chip">{CATEGORIES[g.category].label}</span>
                  <ul>
                    {g.items.map((it, i) => (
                      <li key={i}>
                        {it.name} <b>{it.qty}</b>
                        {it.note ? ` · ${it.note}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </details>
        )}

        {categories.map((c) => {
          const sub = subtotals[c] ?? { count: 0, sum: 0 };
          return (
            <div className="invcat" key={c}>
              <div className="invcat__head">
                <span className="chip">{CATEGORIES[c].label}</span>
                {sub.sum > 0 && (
                  <span className="invcat__sum">{fmt(sub.sum)}원</span>
                )}
              </div>
              <div className="invcols">
                <span>품목</span>
                <span>수량</span>
                <span>단가</span>
                <span style={{ textAlign: "right" }}>금액</span>
              </div>
              {(rowsByCat[c] ?? []).map((r) => {
                const amt = rowAmount(r);
                return (
                  <div className="invrow" key={r.id}>
                    <input
                      className="input"
                      value={r.name}
                      onChange={(e) => updateRow(c, r.id, "name", e.target.value)}
                      placeholder="품목"
                    />
                    <input
                      className="input"
                      inputMode="decimal"
                      value={r.qty}
                      onChange={(e) => updateRow(c, r.id, "qty", e.target.value)}
                      placeholder="수량"
                    />
                    <input
                      className="input"
                      inputMode="numeric"
                      value={r.unitPrice}
                      onChange={(e) =>
                        updateRow(c, r.id, "unitPrice", e.target.value)
                      }
                      placeholder="단가"
                    />
                    <span className="invrow__amt">
                      {amt > 0 ? fmt(amt) : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          );
        })}

        <div className="field" style={{ marginTop: 14 }}>
          <label className="label" htmlFor="invmemo">
            메모 (선택 · 점주에게 표시)
          </label>
          <input
            id="invmemo"
            name="memo"
            className="input"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="예) 입금 계좌 하나은행 000-000000-00000 새롭"
          />
        </div>

        <div className="invtotal">
          <span>합계 · 자동 계산 ({totalCount}건)</span>
          <b>{fmt(total)}원</b>
        </div>

        {!confirming ? (
          <div className="confirm__actions" style={{ marginTop: 16 }}>
            <DraftSaveButton />
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                if (validate()) setConfirming(true);
              }}
            >
              발행하기
            </button>
          </div>
        ) : (
          <div className="confirm">
            <input type="hidden" name="mode" value="issue" />
            <div className="confirm__title">이대로 발행할까요?</div>
            <div className="confirm__list">
              {categories
                .filter((c) => (subtotals[c]?.count ?? 0) > 0)
                .map((c) => (
                  <div className="confirm__row" key={c}>
                    <span className="confirm__cat">{CATEGORIES[c].label}</span>
                    <span className="confirm__dest">
                      {subtotals[c].count}건
                    </span>
                    <span className="confirm__n">{fmt(subtotals[c].sum)}원</span>
                  </div>
                ))}
            </div>
            <div className="invtotal" style={{ marginTop: 10 }}>
              <span>총 결제요청 금액</span>
              <b>{fmt(total)}원</b>
            </div>
            <p className="confirm__hint">
              발행하면 점주에게 &lsquo;입금요청서&rsquo; 알림이 가요. 발행 후
              수정은 취소 → 재작성으로만 가능해요.
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

      {invoiceId && (
        <div style={{ marginTop: 20 }}>
          {!confirmingDelete ? (
            <button
              type="button"
              className="linkbtn linkbtn--danger"
              onClick={() => setConfirmingDelete(true)}
            >
              임시 계산서 삭제
            </button>
          ) : (
            <form action={deleteInvoiceDraftAction} className="confirm">
              <input type="hidden" name="invoiceId" value={invoiceId} />
              <div className="confirm__title">정말 삭제할까요?</div>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  취소
                </button>
                <button className="btn btn--danger">네, 삭제합니다</button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
