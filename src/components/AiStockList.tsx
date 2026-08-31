"use client";

import type { StockMatch } from "@/lib/stock-match";

const won = (n: number) => n.toLocaleString("ko-KR");

// 챗봇 답변 아래 '재고 카드' — 열람 전용(재고 조회만).
// 공구=예약발주 단일 소스 전환으로 재고현황 담기 폐지 → 담기 버튼·실시간 폴링 제거.
export function AiStockList({ items }: { items: StockMatch[] }) {
  return (
    <div className="aistock">
      {items.map((it) => {
        const avail = it.available;
        return (
          <div className="aistock__row" key={it.itemId}>
            <div className="aistock__main">
              <div className="aistock__name">
                {it.name}
                {it.major && (
                  <span className="stockcat">
                    {it.major}
                    {it.minor ? ` · ${it.minor}` : ""}
                  </span>
                )}
              </div>
              <div className="aistock__sub">
                <span
                  className={`badge ${
                    avail <= 0
                      ? "badge--danger"
                      : avail < 5
                        ? "badge--wait"
                        : "badge--ok"
                  }`}
                >
                  {avail <= 0 ? "품절" : `${avail}개`}
                </span>
                {it.supplyPrice > 0 && (
                  <span className="aistock__price">{won(it.supplyPrice)}원</span>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
