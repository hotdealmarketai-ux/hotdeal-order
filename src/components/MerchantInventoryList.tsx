"use client";

import { useState } from "react";
import { StockCartButton } from "./StockCartButton";
import { InvSearch } from "./InvSearch";
import { useLiveStock } from "@/lib/useLiveStock";
import { expiryInfo } from "@/lib/date";

type Item = {
  id: string;
  name: string;
  available: number; // 실시간 남은수량(기준재고 − 전체 담기)
  mine: number; // 내가 담은 수량
  supplyPrice: number;
  expiry: string; // #9 유통기한 "YYYY-MM-DD"(빈값=없음)
};

const won = (n: number) => n.toLocaleString("ko-KR");

const SORTS = [
  { key: "name", label: "가나다순" },
  { key: "qtyDesc", label: "재고 많은순" },
  { key: "qtyAsc", label: "재고 적은순" },
  { key: "expAsc", label: "유통기한 짧은순" },
  { key: "expDesc", label: "유통기한 긴순" },
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

  // 유통기한까지 남은 일수(없거나 형식오류면 null → 정렬 시 맨 뒤로)
  const expDaysOf = (it: Item) => expiryInfo(it.expiry)?.days ?? null;
  const sorted = [...filtered].sort((a, b) => {
    switch (sort) {
      case "qtyDesc":
        return b.available - a.available || a.name.localeCompare(b.name, "ko");
      case "qtyAsc":
        return a.available - b.available || a.name.localeCompare(b.name, "ko");
      case "expAsc":
      case "expDesc": {
        const da = expDaysOf(a);
        const db = expDaysOf(b);
        // 유통기한 없는 제품은 항상 뒤로(둘 다 없으면 가나다순)
        if (da == null && db == null) return a.name.localeCompare(b.name, "ko");
        if (da == null) return 1;
        if (db == null) return -1;
        const diff = sort === "expAsc" ? da - db : db - da;
        return diff || a.name.localeCompare(b.name, "ko");
      }
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
          const exp = expiryInfo(it.expiry);
          return (
          <div className="row" key={it.id}>
            <div className="row__main">
              <div className="row__title">{it.name}</div>
              {/* 한 줄 정리 — 배지 남발 대신 muted 텍스트, 색은 긴급(품절/유통임박)에만 */}
              <div className="stockmeta">
                <span
                  className={`stockmeta__qty${
                    avail <= 0 ? " is-out" : avail < 5 ? " is-low" : ""
                  }`}
                >
                  {avail <= 0 ? "품절" : `남은 수량 ${avail}개`}
                </span>
                {it.supplyPrice > 0 && <span>공급가 {won(it.supplyPrice)}원</span>}
                {exp && (
                  <span className={`stockmeta__exp${exp.level !== "ok" ? " is-warn" : ""}`}>
                    유통기한 {exp.full} · {exp.dday}
                  </span>
                )}
                {mineQ > 0 && <span className="stockmeta__mine">담음 {mineQ}개</span>}
              </div>
            </div>
            <StockCartButton
              itemId={it.id}
              name={it.name}
              disabled={!canAdd}
              available={avail}
              mine={mineQ}
              supplyPrice={it.supplyPrice}
              expiry={it.expiry}
            />
          </div>
          );
        })}
      </div>
    </>
  );
}
