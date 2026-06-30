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
}: {
  categories: Category[];
  needsPickup: boolean;
  locked?: boolean;
}) {
  // 채움채(TOFU)는 체크리스트, 나머지(과일·야채·공구)는 자유 입력
  const chatCats = categories.filter((c) => c !== "TOFU");
  const hasTofu = categories.includes("TOFU");
  const multi = chatCats.length > 1;
  const uid = useRef(0);

  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("compose");
  const [items, setItems] = useState<EditItem[]>([]);
  const [tofuQty, setTofuQty] = useState<Record<string, string>>({});
  const [pickup, setPickup] = useState("");
  const [error, setError] = useState("");
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    createOrderAction,
    {},
  );

  const tofuChecked = () =>
    CHAEUMCHAE_CATALOG.some((p) => (tofuQty[p.seq] ?? "").trim());

  async function handleParse() {
    setError("");
    if (!text.trim() && !tofuChecked()) {
      setError("발주 내용을 적거나 채움채 품목을 선택해 주세요.");
      return;
    }
    if (!text.trim()) {
      // 채움채만 발주
      setItems([]);
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
      setItems(flat);
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
    if (hasTofu) {
      const tofuItems = CHAEUMCHAE_CATALOG.filter(
        (p) => (tofuQty[p.seq] ?? "").trim(),
      ).map((p) => ({ name: p.name, qty: tofuQty[p.seq].trim(), note: "" }));
      if (tofuItems.length) byCat.set("TOFU", tofuItems);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      items: byCat.get(c)!,
    }));
  }, [items, tofuQty, hasTofu]);

  const totalItems = payload.reduce((n, g) => n + g.items.length, 0);

  // 여러 종류를 넣는 점주(핫딜)만 종류 안내, 단일(서부일광 소매)은 한 줄만
  const greetingLines = multi
    ? ["필요하신 품목을 편하게 적어 주세요.", "종류를 섞어 적으셔도 알아서 나눠 드려요."]
    : ["필요하신 품목을 편하게 적어 주세요."];
  const example = multi ? "예) 행사용 사과 20박스 싼걸로, 대파 5단, 양배추 3통" : "";

  // 채움채 체크리스트 UI
  const tofuList = hasTofu ? (
    <div style={{ marginTop: 16 }}>
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        채움채
      </div>
      <div className="tofulist">
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

          {items.length > 0 && (
            <div className="chatedit">
              {items.map((it) => (
                <div className="chatedit__item" key={it.id}>
                  <div className="chatedit__head">
                    {multi ? (
                      <select
                        className="chatedit__cat"
                        value={it.category}
                        onChange={(e) => updateItem(it.id, "category", e.target.value)}
                        aria-label="종류"
                      >
                        {chatCats.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORIES[c].label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="chip">{CATEGORIES[chatCats[0]].label}</span>
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
          )}

          {tofuList}

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
