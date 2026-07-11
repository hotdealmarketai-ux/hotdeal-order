// ============================================================
//  OrderForm — 코발트 교체본
//  위치: src/components/OrderForm.tsx 교체
//
//  변경(표시만, 로직 100% 동일):
//  ③ 큰 제목 "발주하기" 삭제 → 오른쪽 정렬 "채팅으로 발주하기" 칩
//  ④ 카테고리 탭: 개별 버튼 → 세그먼트 컨트롤(활성 탭에 ·N 카운트)
//  ⑤ "받는 곳" 밴드 삭제 → "발주 품목 · {받는곳}" + "N건" 라벨 줄
//  ⑥ 품목 입력: 낱개 카드 → 리스트 카드(번호칩·파란 좌측보더·삭제)
//     ※ 빈 마지막 행 자동 추가(withTrailingEmpty) 로직 그대로 =
//       마지막 옅은 행이 곧 "품목 추가" 역할
//  ⑦ CTA: "발주하기" → "발주 확정 · N건" + sticky
//
//  유지: payload/hidden input, 채움채(TOFU) 체크리스트, 픽업시간,
//        locked fieldset, 확인 시트(모달), useActionState, 에러 표시
// ============================================================

"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  createOrderAction,
  previewGridOrderAction,
  type OrderFormState,
} from "@/app/actions/order";
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
  const [tofuQty, setTofuQty] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
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

  // '발주 확정' → AI가 먼저 정리(오타→고유명사 등)한 결과를 확인 시트에 보여준다(채팅 발주와 동일).
  // 정리된 값으로 칸을 갱신 → 시트에서 확인·수정 후 최종 발주(preNormalized=1로 그대로 저장).
  async function handleConfirmClick() {
    if (totalItems === 0) {
      setLocalError("발주할 품목을 한 개 이상 입력하세요.");
      return;
    }
    setLocalError("");
    setPreviewing(true);
    try {
      const res = await previewGridOrderAction(JSON.stringify(payload));
      if (!res.ok) {
        setLocalError(res.error ?? "정리에 실패했어요. 다시 시도해 주세요.");
        return;
      }
      // AI 정리 결과로 비-TOFU 칸을 갱신(TOFU는 tofuQty 그대로) → 시트가 '정리된 값'을 보여줌
      setRowsByCat((prev) => {
        const next = { ...prev };
        for (const g of res.groups ?? []) {
          next[g.category] = withTrailingEmpty(
            g.items.map((it) => ({
              id: ++uid.current,
              name: it.name,
              qty: it.qty,
              note: it.note,
            })),
          );
        }
        return next;
      });
      setConfirming(true);
    } catch {
      setLocalError("정리 중 문제가 생겼어요. 다시 시도해 주세요.");
    } finally {
      setPreviewing(false);
    }
  }

  if (mode === "chat") {
    return (
      <div>
        <div className="modetoggle">
          <button
            type="button"
            className="chatchip"
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
      {/* 확인 시트의 값은 이미 AI가 정리한(그리고 점주가 확인·수정한) 결과 →
          저장 시 재정규화하지 않고 그대로 저장(승인=저장 보장). */}
      <input type="hidden" name="preNormalized" value="1" />
      {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}

      {/* ③ 제목 삭제 → 채팅 발주 칩 */}
      <div className="modetoggle">
        <button
          type="button"
          className="chatchip"
          onClick={() => setMode("chat")}
        >
          💬 채팅으로 발주하기
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
        {/* ④ 세그먼트 탭 (발주 폼 전용 스코프) */}
        {multi && (
          <div className="cattabs cattabs--seg">
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

        {/* ⑤ 받는 곳 밴드 → 라벨 줄 통합 */}
        <div className="itemshead">
          <span className="itemshead__label">
            발주 품목 · {receiverLabel(active, role)}
          </span>
          <span className="itemshead__count">{countByCat[active] ?? 0}건</span>
        </div>

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
          /* ⑥ 리스트 카드 */
          <div className="oitems">
            {rows.map((r, i) => {
              const filled = isFilled(r);
              return (
                <div
                  className={`oitem ${filled ? "is-filled" : ""}`}
                  key={r.id}
                >
                  <span className="oitem__num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="oitem__fields">
                    <div className="oitem__row1">
                      <input
                        className="input"
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
                    </div>
                    <input
                      className="input"
                      value={r.note}
                      onChange={(e) => updateRow(r.id, "note", e.target.value)}
                      placeholder="설명"
                    />
                  </div>
                  {filled && (
                    <button
                      type="button"
                      className="oitem__del"
                      onClick={() => removeRow(r.id)}
                    >
                      삭제
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ⑦ CTA */}
        <div className="ctabar">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={locked || previewing}
            onClick={handleConfirmClick}
          >
            {previewing
              ? "AI가 정리 중…"
              : `발주 확정${totalItems > 0 ? ` · ${totalItems}건` : ""}`}
          </button>
        </div>

        {/* 확인 시트 — 기존 그대로 */}
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
                AI가 이렇게 정리했어요. 맞는지 확인하고 고칠 부분은 바로 수정해 주세요.
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
                <SubmitButton pendingText="발주 넣는 중…">
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
