"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import {
  createOrderAction,
  parseChatOrderAction,
  type OrderFormState,
  type ChatParseState,
} from "@/app/actions/order";
import { SubmitButton } from "./SubmitButton";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";

type Phase = "compose" | "loading" | "preview";
type EditItem = {
  id: number;
  category: Category;
  name: string;
  qty: string;
  note: string;
};

export function ChatOrder({
  categories,
  needsPickup,
  locked = false,
  reservedTool = [],
  reservedLabel = "",
  toolCart = [],
}: {
  categories: Category[];
  needsPickup: boolean;
  locked?: boolean;
  reservedTool?: { name: string; qty: number }[];
  reservedLabel?: string;
  toolCart?: { name: string; qty: string }[];
}) {
  // 채움채(TOFU)=체크리스트. 공구(TOOL)=자유입력 불가(담기/예약분만). 자유입력은 과일·야채만.
  const chatCats = categories.filter((c) => c !== "TOFU" && c !== "TOOL");
  const hasTofu = categories.includes("TOFU");
  const hasTool = categories.includes("TOOL");
  const multi = chatCats.length > 1;
  // 미리보기 탭 — 공구는 탭에서 제외(자유입력 없음, 담기/예약분은 아래 고정 블록).
  const tabCats = categories.filter((c) => c !== "TOOL");
  const showTabs = tabCats.length > 1;
  const uid = useRef(0);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("compose");
  const [items, setItems] = useState<EditItem[]>([]);
  const [tofuQty, setTofuQty] = useState<Record<string, string>>({});
  // 채움채 발주 온오프(기본 오프) — 켜야 채움채 품목 선택이 열림
  const [tofuOpen, setTofuOpen] = useState(false);
  const [pickup, setPickup] = useState("");
  const [previewTab, setPreviewTab] = useState<Category>(tabCats[0] ?? categories[0]);
  const [error, setError] = useState("");
  // 채팅에서 공구를 자유입력한 경우 무시하고 안내
  const [droppedTool, setDroppedTool] = useState(false);
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    createOrderAction,
    {},
  );
  // 재고 담기(서버 담기원장)로 담아둔 공구 품목 — 발주에 함께 포함 + 화면에 읽기전용 노출
  const [cartItems] = useState<{ name: string; qty: string }[]>(() => toolCart);

  const tofuChecked = () =>
    tofuOpen && CHAEUMCHAE_CATALOG.some((p) => (tofuQty[p.seq] ?? "").trim());

  async function handleParse() {
    setError("");
    setDroppedTool(false);
    const cart = hasTool ? cartItems : [];
    const hasAny =
      text.trim() || tofuChecked() || cart.length > 0 || reservedTool.length > 0;
    if (!hasAny) {
      setError("발주 내용을 적거나 채움채 품목을 선택해 주세요.");
      return;
    }
    if (!text.trim()) {
      // 텍스트 없이 담기/예약분/채움채만 → 바로 미리보기(공구는 아래 고정 블록으로 표시)
      setItems([]);
      setPreviewTab(hasTofu && tofuChecked() ? "TOFU" : tabCats[0] ?? categories[0]);
      setPhase("preview");
      return;
    }
    setPhase("loading");
    try {
      const res: ChatParseState = await parseChatOrderAction(text);
      if (!res.ok || !res.groups) {
        setError(res.error ?? "정리에 실패했어요. 다시 적어 주세요.");
        setPhase("compose");
        return;
      }
      const flat: EditItem[] = [];
      let dropped = false;
      for (const g of [...res.groups].sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
      )) {
        if (g.category === "TOOL") {
          if (g.items.length > 0) dropped = true; // 공구 자유입력은 무시(담기로만)
          continue;
        }
        for (const it of g.items) {
          flat.push({ id: ++uid.current, category: g.category, ...it });
        }
      }
      setDroppedTool(dropped);
      setItems(flat);
      if (flat.length) setPreviewTab(flat[0].category);
      else setPreviewTab(hasTofu && tofuChecked() ? "TOFU" : tabCats[0] ?? categories[0]);
      if (needsPickup && res.pickupTime) setPickup(res.pickupTime);
      setPhase("preview");
    } catch {
      setError("정리에 실패했어요. 다시 시도해 주세요.");
      setPhase("compose");
    }
  }

  function updateItem(
    id: number,
    field: "category" | "name" | "qty" | "note",
    value: string,
  ) {
    setItems((prev) =>
      prev.map((it) => (it.id === id ? ({ ...it, [field]: value } as EditItem) : it)),
    );
  }
  function removeItem(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }

  // 편집한 청과/공구 + 채움채 체크리스트를 합쳐 카테고리별 payload
  const payload = useMemo(() => {
    const byCat = new Map<Category, { name: string; qty: string; note: string }[]>();
    for (const it of items) {
      if (!(it.name.trim() || it.qty.trim() || it.note.trim())) continue;
      const list = byCat.get(it.category) ?? [];
      list.push({ name: it.name, qty: it.qty, note: it.note });
      byCat.set(it.category, list);
    }
    if (hasTofu && tofuOpen) {
      const tofuItems = CHAEUMCHAE_CATALOG.filter(
        (p) => (tofuQty[p.seq] ?? "").trim(),
      ).map((p) => ({ name: p.name, qty: tofuQty[p.seq].trim(), note: "" }));
      if (tofuItems.length) byCat.set("TOFU", tofuItems);
    }
    // 담기(공구)는 읽기전용이지만 발주엔 포함 — payload에 직접 추가(예약분은 단일출처라 미포함)
    if (hasTool && cartItems.length > 0) {
      const tool = cartItems
        .filter((c) => c.name.trim())
        .map((c) => ({ name: c.name, qty: c.qty, note: "" }));
      if (tool.length) byCat.set("TOOL", tool);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      items: byCat.get(c)!,
    }));
  }, [items, tofuQty, hasTofu, tofuOpen, hasTool, cartItems]);

  const totalItems = payload.reduce((n, g) => n + g.items.length, 0);

  // 미리보기 탭 뱃지용 — 카테고리별 건수
  const previewCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      if (!(it.name.trim() || it.qty.trim() || it.note.trim())) continue;
      m[it.category] = (m[it.category] ?? 0) + 1;
    }
    return m;
  }, [items]);
  const tofuCount = CHAEUMCHAE_CATALOG.filter(
    (p) => (tofuQty[p.seq] ?? "").trim(),
  ).length;

  // 여러 종류를 넣는 점주(핫딜)만 종류 안내, 단일(서부일광 소매)은 한 줄만
  const greetingLines = multi
    ? ["필요하신 품목을 편하게 적어 주세요.", "종류를 섞어 적으셔도 알아서 나눠 드려요."]
    : ["필요하신 품목을 편하게 적어 주세요."];
  const example = multi ? "예) 행사용 사과 20박스 싼걸로, 대파 5단, 양배추 3통" : "";

  // 채움채 체크리스트 UI
  const tofuList = hasTofu ? (
    <div style={{ marginTop: 16 }}>
      {/* 채움채 발주 온오프 토글 — 켜야 아래 품목 선택이 열림(기본 오프) */}
      <div className="pushcard">
        <div className="pushcard__main">
          <div className="pushcard__title">채움채 발주</div>
          <div className="pushcard__sub">
            두부·콩나물 등 채움채 품목도 함께 발주해요.
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={tofuOpen}
          aria-label="채움채 발주"
          className={`switch ${tofuOpen ? "is-on" : ""}`}
          onClick={() => setTofuOpen((v) => !v)}
          disabled={locked}
        >
          <span className="switch__knob" />
        </button>
      </div>

      {tofuOpen && (
        <div className="tofulist" style={{ marginTop: 10 }}>
          {CHAEUMCHAE_CATALOG.map((p) => {
            const q = tofuQty[p.seq] ?? "";
            return (
              <div className={`tofuitem ${q.trim() ? "is-on" : ""}`} key={p.seq}>
                <span className="tofuitem__name">{p.name}</span>
                <input
                  className="input tofuitem__qty"
                  inputMode="numeric"
                  value={q}
                  onChange={(e) =>
                    setTofuQty((prev) => ({ ...prev, [p.seq]: e.target.value }))
                  }
                  placeholder="수량"
                  disabled={locked}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  ) : null;

  // 공구(TOOL) 읽기전용 블록 — 예약분(자동) + 담은 재고. 자유입력 없음.
  const toolBlock =
    hasTool && (reservedTool.length > 0 || cartItems.length > 0) ? (
      <div className="toolro" style={{ marginTop: 14 }}>
        {reservedTool.length > 0 && (
          <div className="toolro__group">
            <div className="toolro__head">
              <span className="chip chip--reserve">예약분</span>
              <span className="toolro__hint">
                {reservedLabel ? `${reservedLabel} · ` : ""}수정 불가
              </span>
            </div>
            {reservedTool.map((it, i) => (
              <div className="toolro__item" key={`rv${i}`}>
                <span className="toolro__name">{it.name}</span>
                <span className="toolro__qty">{it.qty}개</span>
              </div>
            ))}
          </div>
        )}
        {cartItems.length > 0 && (
          <div className="toolro__group">
            <div className="toolro__head">
              <span className="chip">담은 재고 · 공구</span>
              <span className="toolro__hint">재고현황에서 수정·삭제</span>
            </div>
            {cartItems.map((c, i) => (
              <div className="toolro__item" key={`ct${i}`}>
                <span className="toolro__name">{c.name}</span>
                <span className="toolro__qty">{c.qty}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    ) : null;

  return (
    <div className="chatorder">
      {locked && (
        <div className="notice notice--mute" style={{ marginBottom: 12 }}>
          지금은 발주 가능 시간이 아니에요.
        </div>
      )}

      <div className="chatbubble chatbubble--bot">
        <div className="chatbubble__text">
          {greetingLines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
        {example && <div className="chatbubble__hint">{example}</div>}
      </div>

      {(error || state?.error) && (
        <div className="notice notice--error" style={{ margin: "12px 0" }}>
          {error || state?.error}
        </div>
      )}

      {phase !== "preview" && (
        <>
          <div className="chatcompose">
            <textarea
              className="chatcompose__input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="여기에 발주 내용을 적어 주세요"
              rows={4}
              disabled={locked || phase === "loading"}
            />
          </div>

          {toolBlock}

          {tofuList}

          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: 14 }}
            onClick={handleParse}
            disabled={locked || phase === "loading"}
          >
            {phase === "loading" ? "AI가 정리 중…" : "발주"}
          </button>
        </>
      )}

      {phase === "preview" && (
        <>
          {text.trim() && (
            <div className="chatbubble chatbubble--me">
              <div className="chatbubble__text" style={{ whiteSpace: "pre-wrap" }}>
                {text}
              </div>
            </div>
          )}

          <div className="chatbubble chatbubble--bot" style={{ marginTop: 12 }}>
            <div className="chatbubble__text">
              이렇게 정리했어요. 맞는지 확인하고 고칠 부분은 바로 수정해 주세요.
            </div>
          </div>

          {/* 카테고리 탭 — 발주가 많아도 종류별로 나눠 확인/수정(세로 스크롤 짧게) */}
          {droppedTool && (
            <div className="notice notice--mute" style={{ marginTop: 12 }}>
              공구 품목은 직접 적을 수 없어요. 재고현황 ‘담기’로 담아주세요. (예약분은 자동 반영)
            </div>
          )}

          {showTabs && (
            <div className="cattabs cattabs--seg" style={{ marginTop: 12 }}>
              {tabCats.map((c) => {
                const n = c === "TOFU" ? tofuCount : previewCounts[c] ?? 0;
                return (
                  <button
                    type="button"
                    key={c}
                    className={`cattab ${previewTab === c ? "is-active" : ""}`}
                    onClick={() => setPreviewTab(c)}
                  >
                    {CATEGORIES[c].label}
                    {n > 0 && <span className="cattab__count">{n}</span>}
                  </button>
                );
              })}
            </div>
          )}

          {/* 채움채 탭 = 체크리스트, 그 외 탭 = 해당 종류의 품목 카드 */}
          {showTabs && previewTab === "TOFU" ? (
            tofuList
          ) : (
            (() => {
              const shown = showTabs
                ? items.filter((it) => it.category === previewTab)
                : items;
              if (shown.length === 0) {
                return (
                  <div className="notice notice--mute" style={{ marginTop: 12 }}>
                    이 종류엔 발주가 없어요.
                  </div>
                );
              }
              return (
                <div className="chatedit">
                  {shown.map((it) => (
                    <div className="chatedit__item" key={it.id}>
                      <div className="chatedit__head">
                        {multi ? (
                          <select
                            className="chatedit__cat"
                            value={it.category}
                            onChange={(e) =>
                              updateItem(it.id, "category", e.target.value)
                            }
                            aria-label="종류"
                          >
                            {chatCats.map((c) => (
                              <option key={c} value={c}>
                                {CATEGORIES[c].label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="chip">
                            {CATEGORIES[chatCats[0]].label}
                          </span>
                        )}
                        <button
                          type="button"
                          className="linkbtn linkbtn--danger"
                          onClick={() => removeItem(it.id)}
                        >
                          삭제
                        </button>
                      </div>
                      <div className="chatedit__fields">
                        <input
                          className="input chatedit__name"
                          value={it.name}
                          onChange={(e) => updateItem(it.id, "name", e.target.value)}
                          placeholder="품목"
                        />
                        <input
                          className="input chatedit__qty"
                          value={it.qty}
                          onChange={(e) => updateItem(it.id, "qty", e.target.value)}
                          placeholder="수량"
                        />
                        <input
                          className="input chatedit__note"
                          value={it.note}
                          onChange={(e) => updateItem(it.id, "note", e.target.value)}
                          placeholder="설명"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()
          )}

          {/* 탭이 없을 때(단일 종류)만 채움채 체크리스트를 아래에 붙인다 */}
          {!showTabs && tofuList}

          {/* 공구(담기·예약분) 읽기전용 — 항상 아래 고정 */}
          {toolBlock}

          {needsPickup && (
            <div className="field" style={{ marginTop: 14 }}>
              <label className="label" htmlFor="chatpickup">
                픽업 시간
              </label>
              <input
                id="chatpickup"
                className="input"
                value={pickup}
                onChange={(e) => setPickup(e.target.value)}
                placeholder="오전 7시 30분"
              />
            </div>
          )}

          <form action={formAction}>
            <input type="hidden" name="payload" value={JSON.stringify(payload)} />
            {/* 채팅 미리보기에서 이미 AI가 정리했고 점주가 확인·수정까지 마친 결과 →
                서버가 저장 시 '재정규화'하지 않고 그대로 저장하도록 표시(승인=저장 보장, 버그 #3). */}
            <input type="hidden" name="preNormalized" value="1" />
            {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}
            <div className="confirm" style={{ marginTop: 16 }}>
              <div className="confirm__title">이대로 발주 넣으시겠습니까?</div>
              <p className="confirm__hint">
                품목 {totalItems}건{multi || hasTofu ? ` · ${payload.length}개 종류` : ""}로 발주됩니다.
              </p>
              <div className="confirm__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setPhase("compose")}
                >
                  다시 적기
                </button>
                <SubmitButton pendingText="발주 넣는 중…" disabled={totalItems === 0}>
                  네, 발주할게요
                </SubmitButton>
              </div>
            </div>
          </form>
        </>
      )}
    </div>
  );
}
