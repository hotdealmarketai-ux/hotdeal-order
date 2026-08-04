"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

export type FlatClosedRow = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  inventoryItemId: string;
  closeAtLabel: string; // "M월 D일 HH:MM" 등 서버 포맷
  totalQty: number;
  storeCount: number;
};

const won = (n: number) => n.toLocaleString("ko-KR");

// 지난 예약 마감 / 지난 픽업 마감 공용 목록 — 상단 검색 + 마감 지난 상품 카드(점포별 상세로 링크).
// 섹터(오늘 마감/마감 여유) 없이 단일 리스트(이미 다 마감된 목록이라 여유 개념이 무의미).
export function FlatClosedList({
  rows,
  emptyText,
}: {
  rows: FlatClosedRow[];
  emptyText: string;
}) {
  const [q, setQ] = useState("");
  const shown = useMemo(() => {
    const query = q.trim();
    return query ? rows.filter((r) => r.name.includes(query)) : rows;
  }, [q, rows]);

  return (
    <>
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="상품 검색"
        style={{ marginBottom: 12 }}
      />
      {shown.length === 0 ? (
        <div className="empty">
          <p>{q.trim() ? "검색 결과가 없어요." : emptyText}</p>
        </div>
      ) : (
        <div className="resvflatwrap">
          {shown.map((p) => (
            <div className="resvflat" key={p.id}>
              <Link href={`/admin/reservations/product/${p.id}`} className="resvflat__main">
                <div className="resvflat__name">
                  {p.name}
                  {p.inventoryItemId ? <span className="resvflat__tag">재고연동</span> : null}
                </div>
                <div className="resvflat__meta">
                  픽업 {p.pickupDate} · 공급가 {won(p.supplyPrice)}원
                </div>
                <div className="resvflat__meta2">
                  <span className="resvflat__cd resvflat__cd--closed">{p.closeAtLabel} 마감</span>
                  <span className="resvflat__agg">
                    총 {p.totalQty}개 · {p.storeCount}점포 ›
                  </span>
                </div>
              </Link>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
