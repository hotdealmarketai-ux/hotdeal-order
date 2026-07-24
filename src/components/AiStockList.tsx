"use client";

import { useLiveStock } from "@/lib/useLiveStock";
import { StockCartButton } from "./StockCartButton";
import type { StockMatch } from "@/lib/stock-match";

const won = (n: number) => n.toLocaleString("ko-KR");

// 챗봇 답변 아래 '재고 카드' — 재고현황 목록의 한 줄과 완전히 동일한 구조.
// useLiveStock로 실시간 남은수량을 받고, 담기/빼기는 기존 StockCartButton(holdStockAction·시트)을
// 그대로 재사용한다(새 담기/빼기 로직을 만들지 않음).
export function AiStockList({
  items,
  canAdd,
}: {
  items: StockMatch[];
  canAdd: boolean;
}) {
  const live = useLiveStock();
  return (
    <div className="aistock">
      {items.map((it) => {
        const avail = live.availableOf(it.itemId, it.available);
        const mineQ = live.mineOf(it.itemId, it.mine);
        return (
          <div className="aistock__row" key={it.itemId}>
            <div className="aistock__main">
              <div className="aistock__name">{it.name}</div>
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
                {mineQ > 0 && <span className="badge badge--ai">담음 {mineQ}개</span>}
                {it.supplyPrice > 0 && (
                  <span className="aistock__price">{won(it.supplyPrice)}원</span>
                )}
              </div>
            </div>
            <StockCartButton
              itemId={it.itemId}
              name={it.name}
              disabled={!canAdd}
              available={avail}
              mine={mineQ}
              supplyPrice={it.supplyPrice}
            />
          </div>
        );
      })}
    </div>
  );
}
