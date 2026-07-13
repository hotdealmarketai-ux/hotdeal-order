"use client";

import { useState } from "react";
import { addToStockCart } from "@/lib/stock-cart";

// 재고현황 각 품목 '담기' — 수량 입력 후 담으면 오늘 발주(공구)에 자동 임시저장. #6
export function StockCartButton({
  name,
  date,
  disabled,
}: {
  name: string;
  date: string;
  disabled: boolean;
}) {
  const [qty, setQty] = useState("");
  const [added, setAdded] = useState(false);

  if (disabled) {
    return (
      <span className="badge badge--mute" style={{ opacity: 0.6 }}>
        담기
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
      <input
        className="input"
        inputMode="numeric"
        value={qty}
        onChange={(e) => setQty(e.target.value)}
        placeholder="수량"
        style={{ width: 58, minHeight: 38, padding: "6px 8px", textAlign: "center" }}
      />
      <button
        type="button"
        className={`btn btn--xs ${added ? "btn--soft" : "btn--primary"}`}
        onClick={() => {
          const q = qty.trim();
          if (!q) return;
          addToStockCart(date, { name, qty: q });
          setAdded(true);
          setQty("");
          setTimeout(() => setAdded(false), 1400);
        }}
      >
        {added ? "담김 ✓" : "담기"}
      </button>
    </div>
  );
}
