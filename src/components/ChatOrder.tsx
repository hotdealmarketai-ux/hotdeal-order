"use client";

import { useActionState, useState } from "react";
import {
  createOrderAction,
  parseChatOrderAction,
  type OrderFormState,
  type ChatParseState,
} from "@/app/actions/order";
import { SubmitButton } from "./SubmitButton";
import { CATEGORIES, CATEGORY_ORDER, type Category } from "@/lib/constants";

type Phase = "compose" | "loading" | "preview";
type Group = { category: Category; items: { name: string; qty: string; note: string }[] };

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
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("compose");
  const [groups, setGroups] = useState<Group[]>([]);
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
      // 카테고리 순서로 정렬
      const sorted = [...res.groups].sort(
        (a, b) =>
          CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category),
      );
      setGroups(sorted);
      if (needsPickup && res.pickupTime) setPickup(res.pickupTime);
      setPhase("preview");
    } catch {
      setError("정리에 실패했어요. 다시 시도해 주세요.");
      setPhase("compose");
    }
  }

  const greeting = multi
    ? "필요하신 품목을 편하게 적어 주세요. 종류(과일·야채·공구·두부)를 섞어 적으셔도 알아서 나눠 드려요."
    : "필요하신 품목을 편하게 적어 주세요.";
  const example = multi
    ? "예) 행사용 사과 20박스 싼걸로, 대파 5단, 두부 10모"
    : "예) 행사용 사과 / 20박스 / 싼걸로\n예) 사장님 오늘 토마토 3개랑 참외 2박스요";

  const totalItems = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="chatorder">
      {locked && (
        <div className="notice notice--mute" style={{ marginBottom: 12 }}>
          지금은 발주 가능 시간이 아니에요.
        </div>
      )}

      {/* 안내 말풍선 */}
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
          {/* 내가 적은 말풍선 */}
          <div className="chatbubble chatbubble--me">
            <div className="chatbubble__text" style={{ whiteSpace: "pre-wrap" }}>
              {text}
            </div>
          </div>

          {/* AI 정리 결과(영수증 미리보기) */}
          <div className="chatbubble chatbubble--bot" style={{ marginTop: 12 }}>
            <div className="chatbubble__text">이렇게 정리했어요. 맞는지 확인해 주세요.</div>
          </div>

          <div className="receipt" style={{ marginTop: 10 }}>
            {groups.map((g) => {
              const cat = CATEGORIES[g.category];
              return (
                <div className="receipt__section" key={g.category}>
                  <div className="section-label" style={{ margin: "0 0 8px" }}>
                    {cat.label}
                    {multi ? ` · ${cat.vendorLabel}` : ""}
                  </div>
                  {g.items.map((it, i) => (
                    <div className="receipt-item" key={i}>
                      <div className="receipt-item__name">{it.name || "-"}</div>
                      <div className="receipt-item__qty">{it.qty}</div>
                      {it.note && (
                        <div className="receipt-item__note">※ {it.note}</div>
                      )}
                    </div>
                  ))}
                </div>
              );
            })}
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
            <input
              type="hidden"
              name="payload"
              value={JSON.stringify(groups)}
            />
            {needsPickup && (
              <input type="hidden" name="pickupTime" value={pickup} />
            )}
            <div className="confirm" style={{ marginTop: 16 }}>
              <div className="confirm__title">이대로 발주 넣으시겠습니까?</div>
              <p className="confirm__hint">
                품목 {totalItems}건{multi ? ` · ${groups.length}개 종류` : ""}로 발주됩니다.
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
