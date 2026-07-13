"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import {
  createOrderAction,
  parseChatOrderAction,
  type OrderFormState,
  type ChatParseState,
} from "@/app/actions/order";
import { SubmitButton } from "./SubmitButton";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import { getStockCart } from "@/lib/stock-cart";
import { kstToday } from "@/lib/date";

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
}: {
  categories: Category[];
  needsPickup: boolean;
  locked?: boolean;
}) {
  // 채움채(TOFU)는 체크리스트, 나머지(과일·야채·공구)는 자유 입력
  const chatCats = categories.filter((c) => c !== "TOFU");
  const hasTofu = categories.includes("TOFU");
  const multi = chatCats.length > 1;
  // 카테고리가 2개 이상이면 미리보기를 '탭'으로 나눠 보여준다(발주 많아도 스크롤 짧게).
  const showTabs = categories.length > 1;
  const uid = useRef(0);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("compose");
  const [items, setItems] = useState<EditItem[]>([]);
  const [tofuQty, setTofuQty] = useState<Record<string, string>>({});
  // 채움채 발주 온오프(기본 오프) — 켜야 채움채 품목 선택이 열림
  const [tofuOpen, setTofuOpen] = useState(false);
  const [pickup, setPickup] = useState("");
  const [previewTab, setPreviewTab] = useState<Category>(categories[0]);
  const [error, setError] = useState("");
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    createOrderAction,
    {},
  );
  // #6 재고현황에서 담아둔 공구 품목(있으면 발주에 함께 포함 + 화면에 노출)
  const [cartItems, setCartItems] = useState<{ name: string; qty: string }[]>([]);
  useEffect(() => {
    if (categories.includes("TOOL")) setCartItems(getStockCart(kstToday()));
  }, [categories]);

  const tofuChecked = () =>
    tofuOpen && CHAEUMCHAE_CATALOG.some((p) => (tofuQty[p.seq] ?? "").trim());

  async function handleParse() {
    setError("");
    const cart = categories.includes("TOOL") ? getStockCart(kstToday()) : [];
    const cartAsItems = (): EditItem[] =>
      cart.map((c) => ({
        id: ++uid.current,
        category: "TOOL" as Category,
        name: c.name,
        qty: c.qty,
        note: "",
      }));
    if (!text.trim() && !tofuChecked() && cart.length === 0) {
      setError("발주 내용을 적거나 채움채 품목을 선택해 주세요.");
      return;
    }
    if (!text.trim()) {
      // 채움채/담아둔 재고만 발주
      setItems(cartAsItems());
      if (cart.length) setPreviewTab("TOOL");
      else if (hasTofu) setPreviewTab("TOFU");
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
      for (const g of [...res.groups].sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
      )) {
        for (const it of g.items) {
          flat.push({ id: ++uid.current, category: g.category, ...it });
        }
      }
      flat.push(...cartAsItems()); // #6 담아둔 재고(공구) 포함
      setItems(flat);
      // 미리보기를 '품목이 있는 첫 종류' 탭으로 연다(빈 탭에서 시작하지 않게)
      if (flat.length) setPreviewTab(flat[0].category);
      else if (hasTofu) setPreviewTab("TOFU");
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
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      items: byCat.get(c)!,
    }));
  }, [items, tofuQty, hasTofu, tofuOpen]);

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

          {cartItems.length > 0 && (
            <div className="notice notice--ai" style={{ marginTop: 12 }}>
              <b>담아둔 재고 · 공구 {cartItems.length}건</b>
              <div style={{ marginTop: 4 }}>
                {cartItems.map((c) => `${c.name} ${c.qty}`).join(" · ")}
              </div>
              <div style={{ fontSize: 12, marginTop: 4, color: "var(--muted)" }}>
                &lsquo;발주&rsquo;를 누르면 함께 발주에 담겨요.
              </div>
            </div>
          )}

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
          {showTabs && (
            <div className="cattabs cattabs--seg" style={{ marginTop: 12 }}>
              {categories.map((c) => {
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
                <SubmitButton pendingText="발주 넣는 중…">
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
