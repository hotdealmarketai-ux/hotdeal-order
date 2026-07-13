"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createWeeklyOrderAction,
  type WeeklyOrderState,
} from "@/app/actions/weekly-order";
import { SubmitButton } from "./SubmitButton";
import {
  WEEKLY_CATEGORIES,
  boxWord,
  pieceWord,
  type WeeklyCategory,
} from "@/lib/weekly-catalog";
import type { WeeklyProductRow } from "@/lib/weekly";

const won = (n: number) => n.toLocaleString("ko-KR");
const catLabel = (k: string) =>
  WEEKLY_CATEGORIES.find((c) => c.key === k)?.label ?? k;

export function WeeklyOrderForm({
  products,
  initialQty = {},
  submitLabel = "발주 확정",
}: {
  products: WeeklyProductRow[];
  initialQty?: Record<string, string>;
  submitLabel?: string;
}) {
  const [qtyByCode, setQtyByCode] = useState<Record<string, string>>(initialQty);
  const cats = WEEKLY_CATEGORIES.filter((c) =>
    products.some((p) => p.category === c.key),
  );
  const [active, setActive] = useState<WeeklyCategory>(
    (cats[0]?.key as WeeklyCategory) ?? "SNACK",
  );
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [state, formAction] = useActionState<WeeklyOrderState, FormData>(
    createWeeklyOrderAction,
    {},
  );

  function setQty(code: string, value: string) {
    setConfirming(false);
    setQtyByCode((prev) => ({ ...prev, [code]: value }));
  }

  const chosen = useMemo(
    () =>
      products
        .map((p) => {
          const qty = Math.floor(Number((qtyByCode[p.code] ?? "").replace(/[^0-9.]/g, "")));
          return { p, qty: Number.isFinite(qty) && qty > 0 ? qty : 0 };
        })
        .filter((r) => r.qty > 0),
    [qtyByCode, products],
  );

  const payload = useMemo(
    () => chosen.map((r) => ({ code: r.p.code, qty: r.qty })),
    [chosen],
  );
  const totalItems = chosen.length;
  const totalAmount = chosen.reduce((n, r) => n + r.qty * r.p.supplyPrice, 0);
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of chosen) m[r.p.category] = (m[r.p.category] ?? 0) + 1;
    return m;
  }, [chosen]);

  const rows = products.filter((p) => p.category === active);

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      <div className="cattabs cattabs--seg">
        {cats.map((c) => {
          const n = countByCat[c.key] ?? 0;
          return (
            <button
              type="button"
              key={c.key}
              className={`cattab ${active === c.key ? "is-active" : ""}`}
              onClick={() => setActive(c.key as WeeklyCategory)}
            >
              {c.label}
              {n > 0 && <span className="cattab__count">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="itemshead">
        <span className="itemshead__label">주간발주 · {catLabel(active)}</span>
        <span className="itemshead__count">{countByCat[active] ?? 0}개</span>
      </div>

      <div className="tofulist">
        {rows.map((p) => {
          const q = qtyByCode[p.code] ?? "";
          return (
            <div className={`tofuitem ${q.trim() ? "is-on" : ""}`} key={p.code}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="tofuitem__name">{p.name}</div>
                <div className="tofuitem__sub">
                  1{boxWord(p.category)} {p.perBox}
                  {pieceWord(p.category)} · 공급가 {won(p.supplyPrice)}원
                </div>
              </div>
              <input
                className="input tofuitem__qty"
                inputMode="numeric"
                value={q}
                onChange={(e) => setQty(p.code, e.target.value)}
                placeholder={boxWord(p.category)}
              />
            </div>
          );
        })}
      </div>

      <div className="ctabar">
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={() => {
            if (totalItems === 0) {
              setLocalError("발주할 품목의 수량을 한 개 이상 입력하세요.");
              return;
            }
            setLocalError("");
            setConfirming(true);
          }}
        >
          {submitLabel}
          {totalItems > 0 ? ` · ${totalItems}개 · ${won(totalAmount)}원` : ""}
        </button>
      </div>

      {confirming && (
        <div
          className="sheet"
          role="dialog"
          aria-modal="true"
          onClick={(e) => {
            if (e.target === e.currentTarget) setConfirming(false);
          }}
        >
          <div className="sheet__panel">
            <div className="sheet__head">
              <div className="sheet__title">이대로 주간발주 할까요?</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={() => setConfirming(false)}
              >
                ✕
              </button>
            </div>
            <p className="sheet__hint">아래 내용이 맞는지 확인하고 발주해 주세요.</p>
            <div className="sheet__body">
              {cats.map((c) => {
                const list = chosen.filter((r) => r.p.category === c.key);
                if (list.length === 0) return null;
                return (
                  <div className="confsec" key={c.key}>
                    <div className="confsec__head">
                      <span className="chip">{c.label}</span>
                      <span className="confsec__dest">{list.length}개</span>
                    </div>
                    {list.map((r) => (
                      <div className="confitem" key={r.p.code}>
                        <span className="confitem__name">{r.p.name}</span>
                        <span className="confitem__qtytext">
                          {r.qty}
                          {boxWord(r.p.category)} · {won(r.qty * r.p.supplyPrice)}원
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <div className="sheet__foot">
              <div className="sheet__count">
                총 {totalItems}개 · {won(totalAmount)}원
              </div>
              <SubmitButton pendingText="발주 넣는 중…">네, 발주할게요</SubmitButton>
            </div>
          </div>
        </div>
      )}
    </form>
  );
}
