"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { reviseInvoiceAction, type InvoiceFormState } from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";
import { MoneyInput } from "./MoneyInput";
import { CATEGORIES, type Category } from "@/lib/constants";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";

type Row = { id: number; name: string; qty: string; unitPrice: string };

export type ReviseInitialItem = {
  category: Category;
  name: string;
  qty: string;
  unitPrice: string;
};

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());
}

// 서버(cleanItems)와 동일한 엄격 파싱 — 형식이 아니면 금액을 표시하지 않는다.
function rowAmount(r: Row): number {
  const qty = parseQtyStrict(r.qty);
  const price = parsePriceStrict(r.unitPrice);
  if (qty == null || price == null) return 0;
  return Math.round(qty * price);
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 입금대기(ISSUED) 계산서를 제자리에서 고쳐 재발송. '계산서 수정' 버튼 → 편집 → 확인 → 재발송.
// 기존 계산서를 지우지 않고 같은 계산서를 갱신한다(점주 알림/링크 유지·중복 없음).
export function ReviseInvoiceForm({
  invoiceId,
  date,
  categories,
  initialItems,
}: {
  invoiceId: string;
  date: string;
  categories: Category[];
  initialItems: ReviseInitialItem[];
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", unitPrice: "" });

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
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
  const [state, formAction] = useActionState<InvoiceFormState, FormData>(
    reviseInvoiceAction,
    {},
  );

  // 채운 줄 + 편집 중 줄만 남기고 후행 빈 줄 하나 유지(빈 칸 자동 축소, 최소 1줄).
  function normalizeRows(list: Row[], editingId?: number): Row[] {
    const kept = list.filter((r) => isFilled(r) || r.id === editingId);
    const last = kept[kept.length - 1];
    if (!last || isFilled(last)) kept.push(newRow());
    return kept;
  }

  function updateRow(cat: Category, id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[cat].map((r) => (r.id === id ? { ...r, [field]: value } : r));
      return { ...prev, [cat]: normalizeRows(list, id) };
    });
  }

  const payload = useMemo(
    () =>
      categories.flatMap((c) =>
        (rowsByCat[c] ?? [])
          .filter(isFilled)
          .map((r) => ({ category: c, name: r.name, qty: r.qty, unitPrice: r.unitPrice })),
      ),
    [categories, rowsByCat],
  );

  const subtotals = useMemo(() => {
    const m: Record<string, { count: number; sum: number }> = {};
    for (const c of categories) {
      const rows = (rowsByCat[c] ?? []).filter(isFilled);
      m[c] = { count: rows.length, sum: rows.reduce((n, r) => n + rowAmount(r), 0) };
    }
    return m;
  }, [categories, rowsByCat]);

  const total = categories.reduce((n, c) => n + (subtotals[c]?.sum ?? 0), 0);
  const totalCount = categories.reduce((n, c) => n + (subtotals[c]?.count ?? 0), 0);

  // 재발송 전 검증 — 서버(cleanItems strict)와 동일 규칙.
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

  if (!editing) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => setEditing(true)}
        >
          계산서 수정
        </button>
        <p className="hint center" style={{ marginTop: 8 }}>
          입금대기 중인 계산서를 고쳐 다시 보냅니다. 같은 계산서가 갱신되고 점주에게
          &lsquo;계산서가 수정되었습니다&rsquo; 알림이 가요.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ marginTop: 16 }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <div className="notice notice--ai" style={{ marginBottom: 12 }}>
        {date} 출고분 계산서를 수정하는 중이에요. 다 고치면 아래 &lsquo;수정해서 다시
        보내기&rsquo;를 눌러 주세요.
      </div>

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      {categories.map((c) => {
        const sub = subtotals[c] ?? { count: 0, sum: 0 };
        return (
          <div className="invcat" key={c}>
            <div className="invcat__head">
              <span className="chip">{CATEGORIES[c].label}</span>
              {sub.sum > 0 && <span className="invcat__sum">{fmt(sub.sum)}원</span>}
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
                  <MoneyInput
                    value={r.unitPrice}
                    onChange={(raw) => updateRow(c, r.id, "unitPrice", raw)}
                    placeholder="단가"
                  />
                  <span className="invrow__amt">{amt > 0 ? fmt(amt) : ""}</span>
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
        <div className="confirm__actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setEditing(false);
              setLocalError("");
            }}
          >
            그만두기
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1.4 }}
            onClick={() => {
              if (validate()) setConfirming(true);
            }}
          >
            수정해서 다시 보내기
          </button>
        </div>
      ) : (
        <div className="confirm">
          <div className="confirm__title">이대로 수정해서 다시 보낼까요?</div>
          {categories
            .filter((c) => (subtotals[c]?.count ?? 0) > 0)
            .map((c) => {
              const rows = (rowsByCat[c] ?? []).filter(isFilled);
              return (
                <div className="invcat" key={c}>
                  <div className="invcat__head">
                    <span className="chip">{CATEGORIES[c].label}</span>
                    <span className="invcat__sum">{fmt(subtotals[c].sum)}원</span>
                  </div>
                  {rows.map((r) => (
                    <div className="invline" key={r.id}>
                      <span>
                        {r.name}
                        <span className="invline__meta">
                          {r.qty} × {r.unitPrice}
                        </span>
                      </span>
                      <span className="invline__amt">{fmt(rowAmount(r))}</span>
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
            같은 계산서가 갱신되고, 점주에게 &lsquo;계산서가 수정되었습니다&rsquo;
            알림이 새로 가요. (기존 계산서는 그대로 유지·갱신되어 중복이 생기지 않아요.)
          </p>
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(false)}
            >
              다시 볼게요
            </button>
            <SubmitButton pendingText="보내는 중…">네, 수정 발송</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}
