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
  const multi = categories.length > 1;
  const uid = useRef(0);
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("compose");
  const [items, setItems] = useState<EditItem[]>([]);
  const [pickup, setPickup] = useState("");
  const [error, setError] = useState("");
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    createOrderAction,
    {},
  );

  async function handleParse() {
    setError("");
    if (!text.trim()) {
      setError("발주 내용을 입력해 주세요.");
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
      prev.map((it) =>
        it.id === id ? ({ ...it, [field]: value } as EditItem) : it,
      ),
    );
  }
  function removeItem(id: number) {
    setItems((prev) => prev.filter((it) => it.id !== id));
  }
  function addItem() {
    setItems((prev) => [
      ...prev,
      { id: ++uid.current, category: categories[0], name: "", qty: "", note: "" },
    ]);
  }

  // 편집된 품목들을 카테고리별로 다시 묶어 발주 payload 생성
  const payload = useMemo(() => {
    const valid = items.filter(
      (it) => it.name.trim() || it.qty.trim() || it.note.trim(),
    );
    const byCat = new Map<Category, { name: string; qty: string; note: string }[]>();
    for (const it of valid) {
      const list = byCat.get(it.category) ?? [];
      list.push({ name: it.name, qty: it.qty, note: it.note });
      byCat.set(it.category, list);
    }
    return CATEGORY_ORDER.filter((c) => byCat.has(c)).map((c) => ({
      category: c,
      items: byCat.get(c)!,
    }));
  }, [items]);

  const totalItems = payload.reduce((n, g) => n + g.items.length, 0);

  const greeting = multi
    ? "필요하신 품목을 편하게 적어 주세요. 종류(과일·야채·공구·두부)를 섞어 적으셔도 알아서 나눠 드려요."
    : "필요하신 품목을 편하게 적어 주세요.";
  const example = multi
    ? "예) 행사용 사과 20박스 싼걸로, 대파 5단, 두부 10모"
    : "예) 행사용 사과 / 20박스 / 싼걸로\n예) 사장님 오늘 토마토 3개랑 참외 2박스요";

  return (
    <div className="chatorder">
      {locked && (
        <div className="notice notice--mute" style={{ marginBottom: 12 }}>
          지금은 발주 가능 시간이 아니에요.
        </div>
      )}

      <div className="chatbubble chatbubble--bot">
        <div className="chatbubble__text">{greeting}</div>
        <div className="chatbubble__hint">{example}</div>
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
          <button
            type="button"
            className="btn btn--primary"
            style={{ marginTop: 12 }}
            onClick={handleParse}
            disabled={locked || phase === "loading"}
          >
            {phase === "loading" ? "AI가 정리 중…" : "발주서로 정리하기"}
          </button>
        </>
      )}

      {phase === "preview" && (
        <>
          <div className="chatbubble chatbubble--me">
            <div className="chatbubble__text" style={{ whiteSpace: "pre-wrap" }}>
              {text}
            </div>
          </div>

          <div className="chatbubble chatbubble--bot" style={{ marginTop: 12 }}>
            <div className="chatbubble__text">
              이렇게 정리했어요. 맞는지 확인하고 고칠 부분은 바로 수정해 주세요.
              {multi ? " 종류가 틀렸으면 칩을 눌러 바꿀 수 있어요." : ""}
            </div>
          </div>

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
                      {categories.map((c) => (
                        <option key={c} value={c}>
                          {CATEGORIES[c].label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="chip">{CATEGORIES[categories[0]].label}</span>
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
            <button type="button" className="linkbtn" onClick={addItem}>
              + 품목 추가
            </button>
          </div>

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
                품목 {totalItems}건{multi ? ` · ${payload.length}개 종류` : ""}로 발주됩니다.
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
