"use client";

import { useState } from "react";
import { StockCartButton } from "./StockCartButton";

type Item = { id: string; name: string; qty: number; supplyPrice: number };

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
  today,
  canAdd,
}: {
  items: Item[];
  today: string;
  canAdd: boolean;
}) {
  const [sort, setSort] = useState<SortKey>("name");
  const [open, setOpen] = useState(false);

  const sorted = [...items].sort((a, b) => {
    switch (sort) {
      case "qtyDesc":
        return b.qty - a.qty || a.name.localeCompare(b.name, "ko");
      case "qtyAsc":
        return a.qty - b.qty || a.name.localeCompare(b.name, "ko");
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
      <div className="invsort">
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

      <div className="list">
        {sorted.map((it) => (
          <div className="row" key={it.id}>
            <div className="row__main">
              <div className="row__title">{it.name}</div>
              <div
                className="row__sub"
                style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}
              >
                <span
                  className={`badge ${
                    it.qty <= 0 ? "badge--danger" : it.qty < 5 ? "badge--wait" : "badge--ok"
                  }`}
                >
                  {it.qty <= 0 ? "품절" : `${it.qty}개`}
                </span>
                {it.supplyPrice > 0 && <span>공급가 {won(it.supplyPrice)}원</span>}
              </div>
            </div>
            <StockCartButton
              name={it.name}
              date={today}
              disabled={!canAdd}
              qty={it.qty}
              supplyPrice={it.supplyPrice}
            />
          </div>
        ))}
      </div>
    </>
  );
}
