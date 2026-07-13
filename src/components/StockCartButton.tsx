"use client";

import { useState, type CSSProperties } from "react";
import { addToStockCart, getStockCart } from "@/lib/stock-cart";
import { Sheet } from "./Sheet";

const won = (n: number) => n.toLocaleString("ko-KR");

// 재고현황 각 품목 '담기' — 누르면 바텀시트가 뜨고, -/+ 스테퍼로 수량을 정해 오늘 발주(공구)에
// 자동 임시저장(#6). 수량은 남은수량(qty)까지만(+ 버튼이 재고에서 비활성). #23
export function StockCartButton({
  name,
  date,
  disabled,
  qty,
  supplyPrice,
}: {
  name: string;
  date: string;
  disabled: boolean;
  qty: number;
  supplyPrice: number;
}) {
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [added, setAdded] = useState(false);

  const soldOut = qty <= 0;
  const max = Math.max(0, qty);

  // 품절이거나 발주창이 닫혀 있으면 담기 불가 — 흐린 배지만
  if (disabled || soldOut) {
    return (
      <span className="badge badge--mute" style={{ opacity: 0.6, flexShrink: 0 }}>
        {soldOut ? "품절" : "담기"}
      </span>
    );
  }

  const openSheet = () => {
    // 이미 담아둔 수량이 있으면 그 값으로 시작(수정), 없으면 1
    const inCart = getStockCart(date).find((c) => c.name === name);
    const start = inCart ? parseInt(inCart.qty, 10) || 1 : 1;
    setCount(Math.min(Math.max(1, start), max));
    setOpen(true);
  };

  const dec = () => setCount((c) => Math.max(1, c - 1));
  const inc = () => setCount((c) => Math.min(max, c + 1));

  const submit = () => {
    const q = Math.min(Math.max(1, count), max);
    addToStockCart(date, { name, qty: String(q) });
    setOpen(false);
    setAdded(true);
    setTimeout(() => setAdded(false), 1600);
  };

  return (
    <>
      <button
        type="button"
        className={`btn btn--xs ${added ? "btn--soft" : "btn--primary"}`}
        style={{ flexShrink: 0 }}
        onClick={openSheet}
      >
        {added ? "담김 ✓" : "담기"}
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">{name}</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={() => setOpen(false)}
              >
                ✕
              </button>
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                margin: "6px 0 18px",
              }}
            >
              <span
                className={`badge ${
                  max < 5 ? "badge--wait" : "badge--ok"
                }`}
              >
                남은 수량 {max}개
              </span>
              {supplyPrice > 0 && (
                <span style={{ fontSize: 13, color: "var(--muted)" }}>
                  공급가 {won(supplyPrice)}원
                </span>
              )}
            </div>

            {/* -/+ 스테퍼 — 남은수량까지만 */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 22,
                padding: "6px 0 18px",
              }}
            >
              <button
                type="button"
                aria-label="수량 감소"
                onClick={dec}
                disabled={count <= 1}
                style={stepBtn(count <= 1)}
              >
                −
              </button>
              <span
                style={{
                  minWidth: 56,
                  textAlign: "center",
                  fontSize: 28,
                  fontWeight: 800,
                  color: "var(--fg)",
                }}
              >
                {count}
              </span>
              <button
                type="button"
                aria-label="수량 증가"
                onClick={inc}
                disabled={count >= max}
                style={stepBtn(count >= max)}
              >
                +
              </button>
            </div>
            {count >= max && (
              <p
                className="sheet__hint"
                style={{ textAlign: "center", marginTop: -8 }}
              >
                남은 수량({max}개)까지만 담을 수 있어요.
              </p>
            )}

            <div className="sheet__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setOpen(false)}
              >
                닫기
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={submit}
              >
                {count}개 담기
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}

function stepBtn(off: boolean): CSSProperties {
  return {
    width: 52,
    height: 52,
    borderRadius: 999,
    border: "1.5px solid var(--line-strong)",
    background: off ? "var(--chip-mute-bg)" : "var(--bg)",
    color: off ? "var(--muted-2)" : "var(--fg)",
    fontSize: 26,
    fontWeight: 700,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: off ? "default" : "pointer",
    flexShrink: 0,
  };
}
