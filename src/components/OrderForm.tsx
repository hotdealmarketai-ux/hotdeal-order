"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { createOrderAction, type OrderFormState } from "@/app/actions/order";
import { SubmitButton } from "./SubmitButton";
import { ChatOrder } from "./ChatOrder";
import {
  CATEGORIES,
  receiverLabel,
  type Category,
  type Role,
} from "@/lib/constants";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";

type Row = { id: number; name: string; qty: string; note: string };

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.note.trim());
}

export function OrderForm({
  categories,
  needsPickup,
  locked = false,
  role,
}: {
  categories: Category[];
  needsPickup: boolean;
  locked?: boolean;
  role: Role;
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", note: "" });

  const [mode, setMode] = useState<"grid" | "chat">("grid");
  const [active, setActive] = useState<Category>(categories[0]);
  const [rowsByCat, setRowsByCat] = useState<Record<string, Row[]>>(() => {
    const init: Record<string, Row[]> = {};
    for (const c of categories) init[c] = [newRow()];
    return init;
  });
  const [pickup, setPickup] = useState("");
  // 채움채(두부류) 체크리스트 수량: product_seq -> 수량 문자열
  const [tofuQty, setTofuQty] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
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
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[active].map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      return { ...prev, [active]: withTrailingEmpty(list) };
    });
  }

  // 확인 모달에서 카테고리 지정 인라인 수정(현재 탭과 무관)
  function updateRowInCat(cat: Category, id: number, field: keyof Row, value: string) {
    setRowsByCat((prev) => {
      const list = (prev[cat] ?? []).map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      return { ...prev, [cat]: withTrailingEmpty(list) };
    });
  }

  function removeRow(id: number) {
    setRowsByCat((prev) => {
      let list = prev[active].filter((r) => r.id !== id);
      if (list.length === 0) list = [newRow()];
      return { ...prev, [active]: withTrailingEmpty(list) };
    });
  }

  const payload = useMemo(
    () =>
      categories
        .map((c) => {
          if (c === "TOFU") {
            // 채움채는 고정 5품목 체크리스트(수량만)
            const items = CHAEUMCHAE_CATALOG.filter(
              (p) => (tofuQty[p.seq] ?? "").trim(),
            ).map((p) => ({ name: p.name, qty: tofuQty[p.seq].trim(), note: "" }));
            return { category: c, items };
          }
          const items = (rowsByCat[c] ?? [])
            .filter(isFilled)
            .map((r) => ({ name: r.name, qty: r.qty, note: r.note }));
          return { category: c, items };
        })
        .filter((g) => g.items.length > 0),
    [categories, rowsByCat, tofuQty],
  );

  const totalItems = payload.reduce((n, g) => n + g.items.length, 0);
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of payload) m[g.category] = g.items.length;
    return m;
  }, [payload]);

  const multi = categories.length > 1;

  if (mode === "chat") {
    return (
      <div>
        <div className="orderhead">
          <h1 className="h1" style={{ margin: 0 }}>
            발주하기
          </h1>
          <button
            type="button"
            className="modetoggle__btn"
            onClick={() => setMode("grid")}
          >
            칸에 직접 입력하기
          </button>
        </div>
        <ChatOrder
          categories={categories}
          needsPickup={needsPickup}
          locked={locked}
        />
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}

      <div className="orderhead">
        <h1 className="h1" style={{ margin: 0 }}>
          발주하기
        </h1>
        <button
          type="button"
          className="modetoggle__btn"
          onClick={() => setMode("chat")}
        >
          채팅으로 발주하기
        </button>
      </div>

      {locked && (
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          지금은 발주 가능 시간이 아니에요. 발주 시작 시간에 다시 입력해 주세요.
        </div>
      )}

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      <fieldset
        disabled={locked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {multi && (
          <div className="cattabs">
            {categories.map((c) => {
              const n = countByCat[c] ?? 0;
              return (
                <button
                  type="button"
                  key={c}
                  className={`cattab ${active === c ? "is-active" : ""}`}
                  onClick={() => setActive(c)}
                >
                  {CATEGORIES[c].label}
                  {n > 0 && <span className="cattab__count">{n}</span>}
                </button>
              );
            })}
          </div>
        )}

        <div className="notice notice--info" style={{ marginBottom: 14 }}>
          받는 곳 · <b>{receiverLabel(active, role)}</b>
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
              placeholder="오전 7시 30분"
            />
          </div>
        )}

        <div className="section-label">발주 품목</div>

        {active === "TOFU" ? (
          <div className="tofulist">
            {CHAEUMCHAE_CATALOG.map((p) => {
              const q = tofuQty[p.seq] ?? "";
              return (
                <div
                  className={`tofuitem ${q.trim() ? "is-on" : ""}`}
                  key={p.seq}
                >
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
          rows.map((r, i) => {
            const filled = isFilled(r);
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
                  placeholder="품목"
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
                  placeholder="설명"
                />
              </div>
            );
          })
        )}

        <div style={{ marginTop: 18 }}>
          <button
            type="button"
            className="btn btn--primary"
            disabled={locked}
            onClick={() => {
              if (totalItems === 0) {
                setLocalError("발주할 품목을 한 개 이상 입력하세요.");
                return;
              }
              setLocalError("");
              setConfirming(true);
            }}
          >
            발주하기
          </button>
        </div>

        {/* 확인 모달 — 발주 전체를 영수증처럼 보여주고, 그 자리에서 바로 수정 가능 */}
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
                <div className="sheet__title">이대로 발주할까요?</div>
                <button
                  type="button"
                  className="sheet__close"
                  aria-label="닫기"
                  onClick={() => setConfirming(false)}
                >
                  ✕
                </button>
              </div>
              <p className="sheet__hint">
                아래 내용이 맞는지 확인하세요. 여기서 바로 수정할 수 있어요.
              </p>

              {(state?.error || localError) && (
                <div className="notice notice--error" style={{ marginBottom: 10 }}>
                  {state?.error || localError}
                </div>
              )}

              <div className="sheet__body">
                {categories.map((c) => {
                  if (c === "TOFU") {
                    const items = CHAEUMCHAE_CATALOG.filter(
                      (p) => (tofuQty[p.seq] ?? "").trim(),
                    );
                    if (items.length === 0) return null;
                    return (
                      <div className="confsec" key={c}>
                        <div className="confsec__head">
                          <span className="chip">{CATEGORIES[c].label}</span>
                          <span className="confsec__dest">
                            {receiverLabel(c, role)} · {items.length}건
                          </span>
                        </div>
                        {items.map((p) => (
                          <div className="confitem" key={p.seq}>
                            <span className="confitem__name">{p.name}</span>
                            <input
                              className="input confitem__qty"
                              inputMode="numeric"
                              value={tofuQty[p.seq] ?? ""}
                              onChange={(e) => {
                                setTofuQty((prev) => ({
                                  ...prev,
                                  [p.seq]: e.target.value,
                                }));
                              }}
                              placeholder="수량"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  }
                  const rows = (rowsByCat[c] ?? []).filter(isFilled);
                  if (rows.length === 0) return null;
                  return (
                    <div className="confsec" key={c}>
                      <div className="confsec__head">
                        <span className="chip">{CATEGORIES[c].label}</span>
                        <span className="confsec__dest">
                          {receiverLabel(c, role)} · {rows.length}건
                        </span>
                      </div>
                      {rows.map((r) => (
                        <div className="confitem confitem--edit" key={r.id}>
                          <input
                            className="input confitem__name"
                            value={r.name}
                            onChange={(e) =>
                              updateRowInCat(c, r.id, "name", e.target.value)
                            }
                            placeholder="품목"
                          />
                          <input
                            className="input confitem__qty"
                            value={r.qty}
                            onChange={(e) =>
                              updateRowInCat(c, r.id, "qty", e.target.value)
                            }
                            placeholder="수량"
                          />
                          <input
                            className="input confitem__note"
                            value={r.note}
                            onChange={(e) =>
                              updateRowInCat(c, r.id, "note", e.target.value)
                            }
                            placeholder="설명"
                          />
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div className="sheet__foot">
                <div className="sheet__count">총 {totalItems}건</div>
                <SubmitButton pendingText="AI가 정리 중…">
                  네, 발주할게요
                </SubmitButton>
              </div>
            </div>
          </div>
        )}
      </fieldset>
    </form>
  );
}
