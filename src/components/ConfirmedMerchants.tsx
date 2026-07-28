"use client";

import { useState } from "react";
import type { BatchConfirmation } from "@/lib/reservation-data";

const won = (n: number) => n.toLocaleString("ko-KR");

// 관리자 예약 배치 — 확정한 점주 목록. 점주를 누르면 어떤 상품을 몇 개 예약했는지 펼쳐 보인다.
export function ConfirmedMerchants({
  confirmations,
}: {
  confirmations: BatchConfirmation[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (confirmations.length === 0) {
    return <div className="empty">아직 확정한 점주가 없어요.</div>;
  }

  // 총 발주 — 전 지점 예약 상품을 품목별로 취합(수량 합산), 많은 순.
  const totalMap = new Map<string, number>();
  let grandQty = 0;
  let grandWon = 0;
  for (const c of confirmations) {
    grandQty += c.qty;
    grandWon += c.total;
    for (const it of c.items)
      totalMap.set(it.name, (totalMap.get(it.name) ?? 0) + it.qty);
  }
  const totals = [...totalMap.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
  const totalOpen = openId === "__TOTAL__";

  return (
    <div className="stack">
      {confirmations.map((c) => {
        const isOpen = openId === c.userId;
        return (
          <div key={c.userId} className="confmerch">
            <button
              type="button"
              className="confmerch__head"
              onClick={() => setOpenId(isOpen ? null : c.userId)}
              aria-expanded={isOpen}
            >
              <span className="resv-conf__name">{c.storeName}</span>
              <span className="confmerch__meta">
                {c.qty}개 · {won(c.total)}원
                <span className="confmerch__caret" aria-hidden="true">
                  {isOpen ? "▲" : "▼"}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="confmerch__items">
                {c.items.map((it, i) => (
                  <div className="confmerch__item" key={i}>
                    <span>{it.name}</span>
                    <span className="confmerch__itemqty">{it.qty}개</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* 총 발주 — 전 지점 예약 상품 취합(항상 맨 아래) */}
      <div className="confmerch confmerch--total">
        <button
          type="button"
          className="confmerch__head"
          onClick={() => setOpenId(totalOpen ? null : "__TOTAL__")}
          aria-expanded={totalOpen}
        >
          <span className="resv-conf__name">총 발주</span>
          <span className="confmerch__meta">
            {grandQty}개 · {won(grandWon)}원
            <span className="confmerch__caret" aria-hidden="true">
              {totalOpen ? "▲" : "▼"}
            </span>
          </span>
        </button>
        {totalOpen && (
          <div className="confmerch__items">
            {totals.length === 0 ? (
              <div className="confmerch__item">
                <span className="muted">예약 상품이 없어요.</span>
              </div>
            ) : (
              totals.map((t, i) => (
                <div className="confmerch__item" key={i}>
                  <span>{t.name}</span>
                  <span className="confmerch__itemqty">{t.qty}개</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
