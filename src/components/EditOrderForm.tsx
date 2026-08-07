"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  updateOrderAction,
  adminUpdateOrderAction,
  type OrderFormState,
} from "@/app/actions/order";
import { holdStockAction } from "@/app/actions/stock";
import { refreshLiveStock } from "@/lib/useLiveStock";
import { SubmitButton } from "./SubmitButton";
import { FulfillmentPicker } from "./FulfillmentPicker";
import { StockPickerSheet, type StockPickItem } from "./StockPickerSheet";
import { InlineStockStepper } from "./InlineStockStepper";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";
import type { ToolHold } from "./OrderForm";
import type { Category, Fulfillment } from "@/lib/constants";

type Row = { id: number; name: string; qty: string; note: string };

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.note.trim());
}

export function EditOrderForm({
  orderId,
  category,
  receiver,
  initialItems,
  needsPickup,
  initialPickup,
  needsFulfillment = false,
  initialFulfillment = "",
  address = "",
  admin = false,
  toolCart = [],
  invOptions = [],
}: {
  orderId: string;
  category: Category;
  receiver: string;
  initialItems: { name: string; qty: string; note: string }[];
  needsPickup: boolean;
  initialPickup?: string;
  needsFulfillment?: boolean;
  initialFulfillment?: "" | Fulfillment;
  address?: string;
  // 저장 주체 — false=점주(updateOrderAction), true=관리자(adminUpdateOrderAction).
  // ⚠ 서버 액션을 prop 함수로 넘기면 제출이 서버까지 안 가는 케이스가 있어(관리자 수정 무반응 버그),
  //   boolean으로만 받고 두 액션을 여기서 직접 import·선택한다.
  admin?: boolean;
  // 공구(TOOL) 수정 — 점주는 실시간 담기(toolCart=내 담기, 스테퍼로 +/-), 관리자는 검색 팝업(invOptions).
  toolCart?: ToolHold[];
  invOptions?: StockPickItem[];
}) {
  const saveAction = admin ? adminUpdateOrderAction : updateOrderAction;
  const router = useRouter();
  const isTofu = category === "TOFU";
  const isTool = category === "TOOL";
  // 공구 수정: 점주 = 실시간 담기(홀드), 관리자 = 검색 팝업(주문 직접). 지난 창 홀드는 이미 해제돼
  // 관리자(창 제약 없음)에게 홀드 재사용은 위험하므로 관리자는 팝업 유지.
  const isToolHold = isTool && !admin;
  const isToolPicker = isTool && admin;
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", note: "" });
  const [pickerOpen, setPickerOpen] = useState(false);

  const [rows, setRows] = useState<Row[]>(() => {
    const seed = initialItems.map((it) => ({
      id: ++uid.current,
      name: it.name,
      qty: it.qty,
      note: it.note,
    }));
    return [...seed, newRow()];
  });
  // 채움채(두부류): 체크리스트 수량 (기존 발주에서 채워 넣음)
  const [tofuQty, setTofuQty] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const it of initialItems) {
      const p = CHAEUMCHAE_CATALOG.find((c) => c.name === it.name.trim());
      if (p) m[p.seq] = it.qty;
    }
    return m;
  });
  const [pickup, setPickup] = useState(initialPickup ?? "");
  const [fulfillment, setFulfillment] = useState<"" | Fulfillment>(
    initialFulfillment,
  );
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    saveAction,
    {},
  );

  // 채워진 줄 + '지금 편집 중인 줄'만 남기고(포커스 유지) 나머지 빈 줄은 접는다.
  // 끝에는 입력용 빈 줄 하나를 항상 유지 → 항목을 지우면 늘어난 빈 칸이 자동으로 줄어든다(최소 1줄).
  function normalizeRows(list: Row[], editingId?: number): Row[] {
    const kept = list.filter((r) => isFilled(r) || r.id === editingId);
    const last = kept[kept.length - 1];
    if (!last || isFilled(last)) kept.push(newRow());
    return kept;
  }

  function updateRow(id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRows((prev) =>
      normalizeRows(
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
        id,
      ),
    );
  }

  function removeRow(id: number) {
    setRows((prev) => normalizeRows(prev.filter((r) => r.id !== id)));
  }

  // [관리자] 공구 재고 검색 팝업에서 품목 선택 → 발주에 바로 추가(담기/홀드 안 씀). 이미 있으면 중복 추가 안 함.
  function addPickedTool(item: StockPickItem) {
    setConfirming(false);
    setRows((prev) => {
      if (prev.some((r) => r.name.trim() === item.name.trim())) return prev;
      const filled = prev.filter(isFilled);
      return [...filled, { id: ++uid.current, name: item.name, qty: "1", note: "" }, newRow()];
    });
  }

  // [점주] 공구 재고 검색 팝업에서 품목 선택 → 담기원장(StockHold)에 +1 실시간 담기(전 지점 반영).
  // 이후 그 자리 스테퍼로 수량 조절. 저장 시 서버가 myHolds로 주문을 재구성.
  async function addHold(item: StockPickItem) {
    setConfirming(false);
    const res = await holdStockAction({ itemId: item.id, qty: 1 });
    if (!res.ok) {
      setLocalError(res.error ?? "담기에 실패했어요.");
      return;
    }
    setLocalError("");
    refreshLiveStock();
    router.refresh(); // toolCart 재조회 → 담은 품목이 스테퍼로 나타남
  }

  // 이미 담은 품목은 아래 스테퍼로 조절하므로, 추가 팝업에는 아직 안 담은 재고만 노출.
  const addableInv = useMemo(
    () => invOptions.filter((o) => !toolCart.some((t) => t.itemId === o.id)),
    [invOptions, toolCart],
  );

  const items = useMemo(() => {
    if (isTofu) {
      return CHAEUMCHAE_CATALOG.filter((p) => (tofuQty[p.seq] ?? "").trim()).map(
        (p) => ({ name: p.name, qty: tofuQty[p.seq].trim(), note: "" }),
      );
    }
    // 공구(점주 담기): 서버 담기원장(toolCart)이 소스 — 개수 표시·저장 검증용(서버는 myHolds로 재구성).
    if (isToolHold) {
      return toolCart.map((t) => ({ name: t.name, qty: t.qty, note: "" }));
    }
    return rows
      .filter(isFilled)
      .map((r) => ({ name: r.name, qty: r.qty, note: r.note }));
  }, [isTofu, isToolHold, toolCart, rows, tofuQty]);

  return (
    <form action={formAction}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />
      {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
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

      {needsFulfillment && (
        <FulfillmentPicker
          value={fulfillment}
          onChange={setFulfillment}
          address={address}
        />
      )}

      <div className="itemshead">
        <span className="itemshead__label">발주 품목 · {receiver}</span>
        <span className="itemshead__count">{items.length}건</span>
      </div>

      {isTofu ? (
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
      ) : isToolHold ? (
        /* 점주 공구 수정 = 실시간 담기. 담은 재고는 스테퍼로 +/-(전 지점 즉시 반영),
           없는 품목은 '재고에서 검색·담기' 팝업으로 담는다. 저장 시 서버가 담기 기준으로 재구성. */
        <div className="toolro">
          {toolCart.length > 0 ? (
            <div className="toolro__group">
              <div className="toolro__head">
                <span className="chip">담은 재고</span>
                <span className="toolro__hint">담기·빼기가 실시간으로 반영돼요</span>
              </div>
              {toolCart.map((t) => (
                <div className="stockline" key={t.itemId}>
                  <div className="stockline__info">
                    <span className="stockline__name">
                      {t.name}
                      {t.majorCat && (
                        <span className="stockcat">
                          {t.majorCat}
                          {t.minorCat ? ` · ${t.minorCat}` : ""}
                        </span>
                      )}
                    </span>
                    <span className="stockmeta">
                      <span className="stockmeta__qty">남은 수량 {t.available}개</span>
                    </span>
                  </div>
                  <InlineStockStepper
                    itemId={t.itemId}
                    available={t.available}
                    mine={t.mine}
                  />
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              담은 공구가 없어요.
              <br />
              아래에서 재고를 검색해 담아 주세요.
            </div>
          )}
          <button
            type="button"
            className="btn btn--soft btn--block"
            style={{ marginTop: 4 }}
            onClick={() => setPickerOpen(true)}
          >
            + 재고에서 검색·담기
          </button>
          {pickerOpen && (
            <StockPickerSheet
              items={addableInv}
              onPick={addHold}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      ) : isToolPicker ? (
        <div className="oitems">
          {rows.filter(isFilled).map((r, i) => (
            <div className="oitem is-filled" key={r.id}>
              <span className="oitem__num">{String(i + 1).padStart(2, "0")}</span>
              <div className="oitem__fields">
                <div className="oitem__row1">
                  <span
                    className="input"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      background: "var(--surface, #f5f6f5)",
                    }}
                  >
                    {r.name}
                  </span>
                  <input
                    className="input"
                    inputMode="decimal"
                    value={r.qty}
                    onChange={(e) => updateRow(r.id, "qty", e.target.value)}
                    placeholder="수량"
                  />
                </div>
              </div>
              <button
                type="button"
                className="oitem__del"
                onClick={() => removeRow(r.id)}
              >
                삭제
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn btn--soft btn--block"
            style={{ marginTop: 4 }}
            onClick={() => setPickerOpen(true)}
          >
            + 재고에서 검색·추가
          </button>
          {pickerOpen && (
            <StockPickerSheet
              items={invOptions}
              onPick={addPickedTool}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </div>
      ) : (
        <div className="oitems">
          {rows.map((r, i) => {
            const filled = isFilled(r);
            return (
              <div className={`oitem ${filled ? "is-filled" : ""}`} key={r.id}>
                <span className="oitem__num">{String(i + 1).padStart(2, "0")}</span>
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

      {!confirming ? (
        <div className="ctabar">
          <button
            type="button"
            className="btn btn--primary btn--block"
            onClick={() => {
              if (items.length === 0) {
                setLocalError(
                  isToolHold
                    ? "담은 공구가 없어요. 재고에서 담아 주세요."
                    : "발주할 품목을 한 개 이상 입력하세요.",
                );
                return;
              }
              if (needsFulfillment && !fulfillment) {
                setLocalError("직접 픽업 또는 배송을 선택해 주세요.");
                return;
              }
              setLocalError("");
              setConfirming(true);
            }}
          >
            수정 완료{items.length > 0 ? ` · ${items.length}건` : ""}
          </button>
        </div>
      ) : (
        <div className="confirm">
          <div className="confirm__title">이대로 수정할까요?</div>
          <p className="confirm__hint">
            수정하면 &lsquo;발주 수정&rsquo;으로 다시 표시됩니다.
          </p>
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(false)}
            >
              다시 볼게요
            </button>
            <SubmitButton pendingText="저장 중…">네, 수정할게요</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}
