"use client";

import { useState } from "react";
import { StockCartButton } from "./StockCartButton";
import { InvSearch } from "./InvSearch";
import { useLiveStock } from "@/lib/useLiveStock";

type Item = {
  id: string;
  name: string;
  available: number; // 실시간 남은수량(기준재고 − 전체 담기)
  mine: number; // 내가 담은 수량
  supplyPrice: number;
};

const won = (n: number) => n.toLocaleString("ko-KR");

const SORTS = [
  { key: "name", label: "가나다순" },
  { key: "qtyDesc", label: "재고 많은순" },
  { key: "qtyAsc", label: "재고 적은순" },
  { key: "priceAsc", label: "공급가 낮은순" },
  { key: "priceDesc", label: "공급가 높은순" },
] as const;
type SortKey = (typeof SORTS)[number]["key"];

// R5 가맹점주 재고현황 — 우상단 '보기' 드롭다운으로 정렬. 깔끔한 커스텀 드롭다운(네이티브 select X).
export function MerchantInventoryList({
  items,
  canAdd,
  hint,
}: {
  items: Item[];
  canAdd: boolean;
  hint: string;
}) {
  const [sort, setSort] = useState<SortKey>("name");
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const live = useLiveStock(); // 남은수량 실시간(다른 점주 담기 반영)

  const query = q.trim().toLowerCase();
  const filtered = query
    ? items.filter((it) => it.name.toLowerCase().includes(query))
    : items;

  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case "qtyDesc":
        return b.available - a.available || a.name.localeCompare(b.name, "ko");
      case "qtyAsc":
        return a.available - b.available || a.name.localeCompare(b.name, "ko");
      case "priceAsc":
        return a.supplyPrice - b.supplyPrice || a.name.localeCompare(b.name, "ko");
      case "priceDesc":
        return b.supplyPrice - a.supplyPrice || a.name.localeCompare(b.name, "ko");
      default:
        return a.name.localeCompare(b.name, "ko");
    }
  });

  return (
    <>
      <InvSearch value={q} onChange={setQ} />

      <div className="invsort">
        <span className="invsort__hint">{hint}</span>
        <button
          type="button"
          className="invsort__btn"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span>보기</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        {open && (
          <>
            <div className="invsort__scrim" onClick={() => setOpen(false)} />
            <div className="invsort__menu" role="menu">
              {SORTS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  role="menuitemradio"
                  aria-checked={s.key === sort}
                  className={`invsort__opt ${s.key === sort ? "is-on" : ""}`}
                  onClick={() => {
                    setSort(s.key);
                    setOpen(false);
                  }}
                >
                  {s.label}
                  {s.key === sort && <span aria-hidden="true">✓</span>}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {query && sorted.length === 0 && (
        <div className="empty">
          <p>‘{q.trim()}’ 검색 결과가 없어요.</p>
        </div>
      )}

      <div className="list">
        {sorted.map((it) => {
          const avail = live.availableOf(it.id, it.available);
          const mineQ = live.mineOf(it.id, it.mine);
          return (
          <div className="row" key={it.id}>
            <div className="row__main">
              <div className="row__title">{it.name}</div>
              <div
                className="row__sub"
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}
              >
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
                {it.supplyPrice > 0 && <span>공급가 {won(it.supplyPrice)}원</span>}
              </div>
            </div>
            <StockCartButton
              itemId={it.id}
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
    </>
  );
}
