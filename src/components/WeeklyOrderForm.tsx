"use client";

import { useActionState, useMemo, useState } from "react";
import {
  createWeeklyOrderAction,
  type WeeklyOrderState,
} from "@/app/actions/weekly-order";
import { SubmitButton } from "./SubmitButton";
import {
  WEEKLY_CATALOG,
  WEEKLY_CATEGORIES,
  type WeeklyCategory,
} from "@/lib/weekly-catalog";

const won = (n: number) => n.toLocaleString("ko-KR");

export function WeeklyOrderForm({
  locked = false,
  initialQty = {},
}: {
  locked?: boolean;
  initialQty?: Record<string, string>;
}) {
  const [qtyByCode, setQtyByCode] = useState<Record<string, string>>(initialQty);
  const [active, setActive] = useState<WeeklyCategory>(WEEKLY_CATEGORIES[0].key);
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

  // 수량 있는 품목만 payload/집계
  const chosen = useMemo(
    () =>
      WEEKLY_CATALOG.map((it) => {
        const qty = Math.floor(Number((qtyByCode[it.seq] ?? "").replace(/[^0-9.]/g, "")));
        return { it, qty: Number.isFinite(qty) && qty > 0 ? qty : 0 };
      }).filter((r) => r.qty > 0),
    [qtyByCode],
  );

  const payload = useMemo(
    () => chosen.map((r) => ({ code: r.it.seq, qty: r.qty })),
    [chosen],
  );
  const totalItems = chosen.length;
  const totalAmount = chosen.reduce((n, r) => n + r.qty * r.it.boxPrice, 0);

  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const r of chosen) m[r.it.category] = (m[r.it.category] ?? 0) + 1;
    return m;
  }, [chosen]);

  const rows = WEEKLY_CATALOG.filter((it) => it.category === active);

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {locked && (
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          지금은 주간발주 시간이 아니에요.
        </div>
      )}

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      <fieldset disabled={locked} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {/* 카테고리 탭 */}
        <div className="cattabs cattabs--seg">
          {WEEKLY_CATEGORIES.map((c) => {
            const n = countByCat[c.key] ?? 0;
            return (
              <button
                type="button"
                key={c.key}
                className={`cattab ${active === c.key ? "is-active" : ""}`}
                onClick={() => setActive(c.key)}
              >
                {c.label}
                {n > 0 && <span className="cattab__count">{n}</span>}
              </button>
            );
          })}
        </div>

        <div className="itemshead">
          <span className="itemshead__label">
            주간발주 · {WEEKLY_CATEGORIES.find((c) => c.key === active)?.label}
          </span>
          <span className="itemshead__count">{countByCat[active] ?? 0}건</span>
        </div>

        <div className="tofulist">
          {rows.map((it) => {
            const q = qtyByCode[it.seq] ?? "";
            return (
              <div className={`tofuitem ${q.trim() ? "is-on" : ""}`} key={it.seq}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="tofuitem__name">{it.name}</div>
                  <div className="tofuitem__sub">
                    {it.boxUnit && <span>{it.boxUnit}</span>}
                    <span> · 박스 {won(it.boxPrice)}원</span>
                  </div>
                </div>
                <input
                  className="input tofuitem__qty"
                  inputMode="numeric"
                  value={q}
                  onChange={(e) => setQty(it.seq, e.target.value)}
                  placeholder="박스"
                />
              </div>
            );
          })}
        </div>

        {/* CTA */}
        <div className="ctabar">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={locked}
            onClick={() => {
              if (totalItems === 0) {
                setLocalError("발주할 품목의 수량을 한 개 이상 입력하세요.");
                return;
              }
              setLocalError("");
              setConfirming(true);
            }}
          >
            발주 확정{totalItems > 0 ? ` · ${totalItems}건 · ${won(totalAmount)}원` : ""}
          </button>
        </div>

        {/* 확인 시트 */}
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
                {WEEKLY_CATEGORIES.map((c) => {
                  const list = chosen.filter((r) => r.it.category === c.key);
                  if (list.length === 0) return null;
                  return (
                    <div className="confsec" key={c.key}>
                      <div className="confsec__head">
                        <span className="chip">{c.label}</span>
                        <span className="confsec__dest">{list.length}건</span>
                      </div>
                      {list.map((r) => (
                        <div className="confitem" key={r.it.seq}>
                          <span className="confitem__name">{r.it.name}</span>
                          <span className="confitem__qtytext">
                            {r.qty}박스 · {won(r.qty * r.it.boxPrice)}원
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div className="sheet__foot">
                <div className="sheet__count">
                  총 {totalItems}건 · {won(totalAmount)}원
                </div>
                <SubmitButton pendingText="발주 넣는 중…">네, 발주할게요</SubmitButton>
              </div>
            </div>
          </div>
        )}
      </fieldset>
    </form>
  );
}
