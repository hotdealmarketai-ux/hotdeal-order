"use client";

import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { rankStockMatches } from "@/lib/stock-match";

export type StockPickItem = { id: string; name: string; available: number };

// 발주 수정에서 공구 품목을 '재고 검색 팝업'으로 고른다. 담기(StockHold)를 거치지 않고
// 선택한 품목을 곧바로 발주(주문 품목)에 넣는다 → 담기와 주문이 어긋나는 문제(유령 홀드) 없음.
// 남은 재고는 참고용으로만 표시(실시간 잠금은 안 함, 최종 재고 정합은 계산서 발행이 담당).
export function StockPickerSheet({
  items,
  onPick,
  onClose,
}: {
  items: StockPickItem[];
  onPick: (item: StockPickItem) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const query = q.trim();
    if (!query) return items;
    const ranked = rankStockMatches(query, items, 100).filter((r) => r.score >= 8);
    const rank = new Map(ranked.map((r, i) => [r.id, i]));
    return items
      .filter((it) => rank.has(it.id))
      .sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  }, [q, items]);

  return (
    <Sheet onClose={onClose}>
      <div
        className="card"
        style={{
          width: "min(520px, 92vw)",
          maxHeight: "80vh",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          padding: 16,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="spread" style={{ alignItems: "center" }}>
          <b style={{ fontSize: 16 }}>재고에서 추가</b>
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            onClick={onClose}
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <input
          className="input"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="재고 품목 검색"
          autoFocus
          autoComplete="off"
        />
        <div style={{ overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {list.length === 0 ? (
            <p className="hint center" style={{ padding: "16px 0" }}>
              {items.length === 0 ? "재고 품목이 없어요." : "검색 결과가 없어요."}
            </p>
          ) : (
            list.map((it) => {
              const out = it.available <= 0;
              return (
                <button
                  type="button"
                  key={it.id}
                  className="row"
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => {
                    onPick(it);
                    onClose();
                  }}
                >
                  <div className="row__main">
                    <div className="row__title">{it.name}</div>
                  </div>
                  <span
                    className="row__sub"
                    style={{
                      flexShrink: 0,
                      color: out ? "var(--danger)" : "var(--muted)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {out ? "품절" : `남은 ${it.available.toLocaleString("ko-KR")}개`}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>
    </Sheet>
  );
}
