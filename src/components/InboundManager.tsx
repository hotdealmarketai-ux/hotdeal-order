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
const HOUR_MS = 60 * 60 * 1000;

type CatNode = { major: string; minors: string[] };

export function InboundManager({
  initialRows,
  catTree,
}: {
  initialRows: InboundRow[];
  catTree: CatNode[];
}) {
  const [rows, setRows] = useState<InboundRow[]>(initialRows);
  const [tree, setTree] = useState<CatNode[]>(catTree);

  // 입력 폼
  const [name, setName] = useState("");
  const [qty, setQty] = useState("");
  const [price, setPrice] = useState("");
  const [expiry, setExpiry] = useState("");
  // 카테고리 — 대분류/중분류 계단식
  const [major, setMajor] = useState(""); // "" | 기존 대분류 | NEW_CAT
  const [minor, setMinor] = useState(""); // "" | 기존 중분류 | NEW_CAT
  const [newMajor, setNewMajor] = useState("");
  const [newMinor, setNewMinor] = useState("");
  const [saving, startSave] = useTransition();

  // 검색(전체 기록 대상, 서버 조회)
  const [q, setQ] = useState("");
  const [searchRows, setSearchRows] = useState<InboundRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 삭제 확인
  const [pendingDelete, setPendingDelete] = useState<InboundRow | null>(null);
  const [deleting, startDelete] = useTransition();

  const minorsForMajor =
    major && major !== NEW_CAT ? tree.find((t) => t.major === major)?.minors ?? [] : [];

  const onMajorChange = (v: string) => {
    setMajor(v);
    setMinor("");
    setNewMinor("");
    if (v !== NEW_CAT) setNewMajor("");
  };

  const resetForm = () => {
    setName("");
    setQty("");
    setPrice("");
    setExpiry("");
    setMajor("");
    setMinor("");
    setNewMajor("");
    setNewMinor("");
  };

  const submit = () => {
    if (!name.trim() || saving) return;
    const majorCat = (major === NEW_CAT ? newMajor : major).trim();
    const minorCat = (
      major === NEW_CAT ? newMinor : minor === NEW_CAT ? newMinor : minor
    ).trim();
    startSave(async () => {
      const res = await createInboundAction({
        name: name.trim(),
        qty,
        supplyPrice: price,
        expiry,
        majorCat,
        minorCat,
      });
      if (res.ok && res.row) {
        setRows((prev) => [res.row!, ...prev]);
        // 새로 쓴 대분류/중분류를 트리에 반영(다음 입력 때 선택지로 뜨게)
        if (majorCat) {
          setTree((prev) => {
            const copy = prev.map((t) => ({ major: t.major, minors: [...t.minors] }));
            let entry = copy.find((t) => t.major === majorCat);
            if (!entry) {
              entry = { major: majorCat, minors: [] };
              copy.push(entry);
              copy.sort((a, b) => a.major.localeCompare(b.major, "ko"));
            }
            if (minorCat && !entry.minors.includes(minorCat)) {
              entry.minors.push(minorCat);
              entry.minors.sort((a, b) => a.localeCompare(b, "ko"));
            }
            return copy;
          });
        }
        resetForm();
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
  // 삭제 대상이 '1시간 이내' 입고인지(현재 시각 기준) → 확인 문구/실제 재고 되돌림 여부
  const pendingRevert = pendingDelete
    ? Date.now() - pendingDelete.createdAtMs < HOUR_MS
    : false;

  return (
    <div className="inb">
      {/* 입력 폼 */}
      <div className="card inb__form">
        <input
          className="input input--compact"
          placeholder="품목명"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <div className="inb__row2">
          <input
            className="input input--compact"
            inputMode="numeric"
            placeholder="수량"
            value={qty}
            onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ""))}
          />
          <MoneyInput
            className="input input--compact"
            placeholder="점주 공급가"
            value={price}
            onChange={setPrice}
          />
        </div>
        <input
          className="input input--compact"
          placeholder="유통기한 27-01-01"
          value={expiry}
          onChange={(e) => setExpiry(e.target.value)}
        />
        {/* 카테고리 — 대분류 선택 → (중분류 있으면) 중분류 선택 */}
        <div className="inb__row2">
          <select
            className="input input--compact inb__catsel"
            value={major}
            onChange={(e) => onMajorChange(e.target.value)}
          >
            <option value="">대분류</option>
            {tree.map((t) => (
              <option key={t.major} value={t.major}>
                {t.major}
              </option>
            ))}
            <option value={NEW_CAT}>+ 직접 입력</option>
          </select>
          {major === NEW_CAT ? (
            <input
              className="input input--compact"
              placeholder="새 대분류"
              value={newMajor}
              onChange={(e) => setNewMajor(e.target.value)}
              autoFocus
            />
          ) : (
            <select
              className="input input--compact inb__catsel"
              value={minor}
              onChange={(e) => setMinor(e.target.value)}
              disabled={!major}
            >
              <option value="">중분류</option>
              {minorsForMajor.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
              {major && <option value={NEW_CAT}>+ 직접 입력</option>}
            </select>
          )}
        </div>
        {(major === NEW_CAT || minor === NEW_CAT) && (
          <input
            className="input input--compact"
            placeholder={major === NEW_CAT ? "새 중분류 (선택)" : "새 중분류"}
            value={newMinor}
            onChange={(e) => setNewMinor(e.target.value)}
            autoFocus={minor === NEW_CAT}
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
                {r.majorCat && (
                  <span className="inb__cat">
                    {r.majorCat}
                    {r.minorCat ? ` / ${r.minorCat}` : ""}
                  </span>
                )}
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

      {/* 삭제 확인 — 1시간 이내면 재고도 함께 취소, 이후면 기록만 */}
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
              {pendingRevert
                ? `방금(1시간 이내) 입고한 기록이에요. 삭제하면 재고현황에 더해진 ${pendingDelete.qty}개도 함께 취소돼요.`
                : "입고한 지 1시간이 지나, 기록만 삭제돼요. 재고 수량은 그대로예요."}
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
