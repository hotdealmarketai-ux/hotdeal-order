"use client";

import { useState } from "react";
import { addToStockCart, getStockCart } from "@/lib/stock-cart";
import { Sheet } from "./Sheet";

const won = (n: number) => n.toLocaleString("ko-KR");

// 재고현황 '담기' — 누르면 하단에서 살짝 올라오는 컴팩트 시트(Q8). 좌측 이미지자리엔 남은수량,
// 가운데 품목명·공급가, 우측 -/+ 스테퍼(남은수량까지). 아래 '담기' 버튼. 오늘 발주(공구)에 임시저장.
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

  if (disabled || soldOut) {
    return (
      <span className="badge badge--mute" style={{ opacity: 0.6, flexShrink: 0 }}>
        {soldOut ? "품절" : "담기"}
      </span>
    );
  }

  const openSheet = () => {
    const inCart = getStockCart(date).find((c) => c.name === name);
    const start = inCart ? parseInt(inCart.qty, 10) || 1 : 1;
    setCount(Math.min(Math.max(1, start), max));
    setOpen(true);
  };
  const dec = () => setCount((c) => Math.max(1, c - 1));
  const inc = () => setCount((c) => Math.min(max, c + 1));
  const submit = () => {
    addToStockCart(date, { name, qty: String(Math.min(Math.max(1, count), max)) });
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
          <div className="sheet__panel stocksheet" style={{ maxWidth: 480 }}>
            <div className="stocksheet__grip" aria-hidden="true" />
            <div className="stockrow">
              <div className="stockrow__thumb">
                <span className="stockrow__thumb-k">남은 수량</span>
                <span className="stockrow__thumb-v">{max}개</span>
              </div>
              <div className="stockrow__info">
                <div className="stockrow__name">{name}</div>
                {supplyPrice > 0 && (
                  <div className="stockrow__price">{won(supplyPrice)}원</div>
                )}
              </div>
              <div className="stepper" role="group" aria-label="수량">
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label="감소"
                  onClick={dec}
                  disabled={count <= 1}
                >
                  −
                </button>
                <span className="stepper__val">{count}</span>
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label="증가"
                  onClick={inc}
                  disabled={count >= max}
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              className="btn btn--primary btn--block stocksheet__add"
              onClick={submit}
            >
              담기
            </button>
          </div>
        </Sheet>
      )}
    </>
  );
}
