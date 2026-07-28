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
    </div>
  );
}
