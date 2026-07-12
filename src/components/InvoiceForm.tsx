"use client";

import { startTransition, useActionState, useMemo, useRef, useState } from "react";
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
  refGroups = [],
  confirmedCats = "",
}: {
  invoiceId?: string;
  userId: string;
  date: string;
  categories: Category[];
  initialItems?: InvoiceInitialItem[];
  refGroups?: InvoiceRefGroup[];
  confirmedCats?: string;
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

  // #11 카테고리별 확정 상태(과일/야채/공구/채움채). 4개 모두 확정돼야 발행 가능.
  const [confirmed, setConfirmed] = useState<Set<string>>(
    () => new Set(confirmedCats.split(",").map((s) => s.trim()).filter(Boolean)),
  );
  const allConfirmed = categories.every((c) => confirmed.has(c));

  // 한 카테고리의 채워진 줄들이 유효한지(빈 카테고리는 유효 — 없는 품목도 확정 가능)
  function validateCat(c: Category): boolean {
    for (const r of (rowsByCat[c] ?? []).filter(isFilled)) {
      if (!r.name.trim()) {
        setLocalError(`${CATEGORIES[c].label}: 품목명이 비어 있는 줄이 있어요.`);
        return false;
      }
      if (parseQtyStrict(r.qty) == null) {
        setLocalError(`${CATEGORIES[c].label} '${r.name}' 수량을 확인해 주세요.`);
        return false;
      }
      if (parsePriceStrict(r.unitPrice) == null) {
        setLocalError(`${CATEGORIES[c].label} '${r.name}' 단가를 확인해 주세요.`);
        return false;
      }
    }
    setLocalError("");
    return true;
  }

  // 확정 상태를 DB에 즉시 저장(현장이 달라 시간차 확정 — 오전 과채, 이후 공구/채움채).
  function persistConfirmed(next: Set<string>) {
    const fd = new FormData();
    if (invoiceId) fd.set("invoiceId", invoiceId);
    fd.set("userId", userId);
    fd.set("date", date);
    fd.set("payload", JSON.stringify(payload));
    fd.set("confirmedCats", [...next].join(","));
    fd.set("allCats", categories.join(","));
    fd.set("mode", "confirm");
    startTransition(() => formAction(fd));
  }
  function toggleConfirm(c: Category) {
    const next = new Set(confirmed);
    if (next.has(c)) {
      next.delete(c); // 수정 — 잠금 해제
    } else {
      if (!validateCat(c)) return; // 확정 — 유효할 때만 잠금
      next.add(c);
    }
    setConfirmed(next);
    persistConfirmed(next);
  }

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
        <input type="hidden" name="confirmedCats" value={[...confirmed].join(",")} />
        <input type="hidden" name="allCats" value={categories.join(",")} />

        {(state?.error || localError) && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            {state?.error || localError}
          </div>
        )}

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
                <button
                  type="button"
                  className={`btn btn--xs ${confirmed.has(c) ? "btn--soft" : "btn--primary"}`}
                  style={{ marginLeft: "auto", flexShrink: 0 }}
                  onClick={() => toggleConfirm(c)}
                >
                  {confirmed.has(c) ? "수정" : "확정"}
                </button>
              </div>
              <div className="invcols">
                <span>품목</span>
                <span>수량</span>
                <span>단가</span>
                <span style={{ textAlign: "right" }}>금액</span>
              </div>
              {(rowsByCat[c] ?? []).map((r) => {
                const amt = rowAmount(r);
                const locked = confirmed.has(c);
                return (
                  <div className="invrow" key={r.id}>
                    <input
                      className="input"
                      value={r.name}
                      disabled={locked}
                      onChange={(e) => updateRow(c, r.id, "name", e.target.value)}
                      placeholder="품목"
                    />
                    <input
                      className="input"
                      inputMode="decimal"
                      value={r.qty}
                      disabled={locked}
                      onChange={(e) => updateRow(c, r.id, "qty", e.target.value)}
                      placeholder="수량"
                    />
                    <input
                      className="input"
                      inputMode="numeric"
                      value={r.unitPrice}
                      disabled={locked}
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

        <div className="invtotal">
          <span>합계 · 자동 계산 ({totalCount}건)</span>
          <b>{fmt(total)}원</b>
        </div>

        {!confirming ? (
          <>
            <div className="confirm__actions" style={{ marginTop: 16 }}>
              <DraftSaveButton />
              <button
                type="button"
                className="btn btn--primary"
                disabled={!allConfirmed}
                onClick={() => {
                  if (validate()) setConfirming(true);
                }}
              >
                발행하기
              </button>
            </div>
            {!allConfirmed && (
              <p className="hint center" style={{ marginTop: 10 }}>
                과일·야채·공구·채움채 <b>4개 모두 확정</b>해야 발행할 수 있어요.
                없는 품목은 비운 채로 확정하면 돼요.
              </p>
            )}
          </>
        ) : (
          <div className="confirm">
            <input type="hidden" name="mode" value="issue" />
            <div className="confirm__title">이대로 발행할까요?</div>
            {categories
              .filter((c) => (subtotals[c]?.count ?? 0) > 0)
              .map((c) => {
                const rows = (rowsByCat[c] ?? []).filter(isFilled);
                return (
                  <div className="invcat" key={c}>
                    <div className="invcat__head">
                      <span className="chip">{CATEGORIES[c].label}</span>
                      <span className="invcat__sum">
                        {fmt(subtotals[c].sum)}원
                      </span>
                    </div>
                    {rows.map((r) => (
                      <div className="invline" key={r.id}>
                        <span>
                          {r.name}
                          <span className="invline__meta">
                            {r.qty} × {r.unitPrice}
                          </span>
                        </span>
                        <span className="invline__amt">
                          {fmt(rowAmount(r))}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
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
