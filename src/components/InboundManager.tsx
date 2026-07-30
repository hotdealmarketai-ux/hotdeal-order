"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { MoneyInput } from "./MoneyInput";
import { Sheet } from "./Sheet";
import {
  createInboundAction,
  deleteInboundAction,
  searchInboundAction,
} from "@/app/actions/inbound";
import type { InboundRow } from "@/lib/inbound";

const NEW_CAT = "__new__"; // 카테고리 '직접 입력' 옵션 값

export function InboundManager({
  initialRows,
  categories,
}: {
  initialRows: InboundRow[];
  categories: string[];
}) {
  const [rows, setRows] = useState<InboundRow[]>(initialRows);
  const [cats, setCats] = useState<string[]>(categories);

  // 입력 폼
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cat, setCat] = useState("");
  const [newCat, setNewCat] = useState("");
  const [saving, startSave] = useTransition();

  // 검색(전체 기록 대상, 서버 조회)
  const [q, setQ] = useState("");
  const [searchRows, setSearchRows] = useState<InboundRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 삭제 확인
  const [pendingDelete, setPendingDelete] = useState<InboundRow | null>(null);
  const [deleting, startDelete] = useTransition();

  const submit = () => {
    if (!name.trim() || saving) return;
    const category = (cat === NEW_CAT ? newCat : cat).trim();
    startSave(async () => {
      const res = await createInboundAction({
        name: name.trim(),
        qty,
        supplyPrice: price,
        expiry,
        majorCat: category,
      });
      if (res.ok && res.row) {
        setRows((prev) => [res.row!, ...prev]);
        if (category && !cats.includes(category))
          setCats((c) => [...c, category].sort((a, b) => a.localeCompare(b, "ko")));
        setName("");
        setQty("");
        setPrice("");
        setExpiry("");
        setCat("");
        setNewCat("");
      }
    });
  };

  // 검색어 디바운스 → 전체 기록 조회
  useEffect(() => {
    const term = q.trim();
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!term) {
      setSearchRows(null);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const res = await searchInboundAction(term);
      setSearchRows(res);
      setSearching(false);
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [q]);

  const confirmDelete = () => {
    const row = pendingDelete;
    if (!row || deleting) return;
    startDelete(async () => {
      await deleteInboundAction(row.id);
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setSearchRows((prev) => (prev ? prev.filter((r) => r.id !== row.id) : prev));
      setPendingDelete(null);
    });
  };

  const list = searchRows ?? rows;

  return (
    <div className="inb">
      {/* 입력 폼 */}
      <div className="card inb__form">
        <input
          className="input input--compact"
          placeholder="우유"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="inb__row2">
          <input
            className="input input--compact"
            inputMode="numeric"
            placeholder="10"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
          />
          <MoneyInput
            className="input input--compact"
            placeholder="3,000"
            value={price}
            onChange={setPrice}
          />
        </div>
        <div className="inb__row2">
          <input
            className="input input--compact"
            placeholder="2026-08-15"
            value={expiry}
            onChange={(e) => setExpiry(e.target.value)}
          />
          <select
            className="input input--compact inb__catsel"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
          >
            <option value="">카테고리</option>
            {cats.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
            <option value={NEW_CAT}>+ 직접 입력</option>
          </select>
        </div>
        {cat === NEW_CAT && (
          <input
            className="input input--compact"
            placeholder="새 카테고리"
            value={newCat}
            onChange={(e) => setNewCat(e.target.value)}
            autoFocus
          />
        )}
        <button
          type="button"
          className="btn btn--primary btn--block"
          onClick={submit}
          disabled={!name.trim() || saving}
        >
          {saving ? "입고 중…" : "입고"}
        </button>
      </div>

      {/* 검색 */}
      <input
        className="input inb__search"
        placeholder="품목명 검색"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      {/* 목록(스크롤) */}
      <div className="inb__list">
        {searching && <div className="inb__empty">검색 중…</div>}
        {!searching && list.length === 0 && (
          <div className="inb__empty">
            {searchRows ? "검색 결과가 없어요." : "입고 기록이 없어요."}
          </div>
        )}
        {!searching &&
          list.map((r) => (
            <div className="inb__item" key={r.id}>
              <div className="inb__top">
                <span className="inb__name">{r.name}</span>
                <span className="inb__at">{r.at}</span>
              </div>
              <div className="inb__meta">
                <span className="inb__qty">{r.qty}개</span>
                <span>{r.supplyPrice.toLocaleString("ko-KR")}원</span>
                {r.expiry && <span>유통 {r.expiry}</span>}
                {r.majorCat && <span className="inb__cat">{r.majorCat}</span>}
              </div>
              <button
                type="button"
                className="inb__x"
                onClick={() => setPendingDelete(r)}
                aria-label="이 입고 기록 삭제"
                title="이 입고 기록 삭제"
              >
                ✕
              </button>
            </div>
          ))}
      </div>

      {/* 삭제 확인 */}
      {pendingDelete && (
        <Sheet onClose={() => !deleting && setPendingDelete(null)}>
          <div className="sheet__panel" style={{ maxWidth: 420 }}>
            <div className="sheet__head">
              <div className="sheet__title">입고 기록 삭제</div>
            </div>
            <div className="sheet__body">
              <b>{pendingDelete.name}</b> {pendingDelete.qty}개 · {pendingDelete.at}
            </div>
            <p className="sheet__hint">
              이 입고 기록만 삭제돼요. 재고 수량은 그대로예요.
            </p>
            <div className="sheet__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setPendingDelete(null)}
                disabled={deleting}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--danger"
                onClick={confirmDelete}
                disabled={deleting}
              >
                {deleting ? "삭제 중…" : "삭제"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
