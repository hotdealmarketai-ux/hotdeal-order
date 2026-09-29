"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoneyInput } from "./MoneyInput";
import { saveFlatProductAction } from "@/app/actions/reservation-flat";

type Inv = { id: string; name: string; supplyPrice: number };

export type FlatClosedRow = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  inventoryItemId: string;
  closeAtLabel: string; // "M월 D일 HH:MM" 등 서버 포맷
  closeAtLocal: string; // "YYYY-MM-DDTHH:MM" (KST) — datetime-local 프리필(수정용)
  stockFixed: boolean;
  totalQty: number;
  storeCount: number;
};

const won = (n: number) => n.toLocaleString("ko-KR");

const EMPTY = { id: "", name: "", closeAt: "", pickup: "", price: "", invId: "", fixed: false };

// 지난 예약 마감 / 지난 픽업 마감 공용 목록 — 상단 검색 + 마감 지난 상품 카드.
// 지난 상품도 진행 중 예약상품처럼 '수정/삭제' 가능(서버 액션은 이미 지난 상품 허용 — closeAt만 있으면 됨).
// 활성 편집기(FlatReservationAdmin)와 동일한 폼·저장 로직을 재사용하되, '등록'은 없고 수정 시에만 폼이 열린다.
export function FlatClosedList({
  rows,
  inventoryItems,
  emptyText,
}: {
  rows: FlatClosedRow[];
  inventoryItems: Inv[];
  emptyText: string;
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [f, setF] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [invSearch, setInvSearch] = useState("");
  const [pending, start] = useTransition();
  const editing = f.id !== "";

  const shown = useMemo(() => {
    const query = q.trim();
    return query ? rows.filter((r) => r.name.includes(query)) : rows;
  }, [q, rows]);

  const invMatches = invSearch.trim()
    ? inventoryItems.filter((i) => i.name.includes(invSearch.trim())).slice(0, 8)
    : [];
  const linkedName = f.invId
    ? (inventoryItems.find((i) => i.id === f.invId)?.name ?? "연동 품목")
    : "";

  const reset = () => {
    setF({ ...EMPTY });
    setErr("");
    setInvSearch("");
  };
  const startEdit = (p: FlatClosedRow) => {
    setErr("");
    setF({
      id: p.id,
      name: p.name,
      closeAt: p.closeAtLocal,
      pickup: p.pickupDate,
      price: String(p.supplyPrice),
      invId: p.inventoryItemId,
      fixed: p.stockFixed,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const pickInv = (id: string) => {
    if (!id) {
      setF((s) => ({ ...s, invId: "" }));
      return;
    }
    const inv = inventoryItems.find((i) => i.id === id);
    setF((s) => ({ ...s, invId: id, name: inv?.name ?? s.name, price: inv ? String(inv.supplyPrice) : s.price }));
  };

  const submit = () => {
    setErr("");
    if (!f.name.trim()) return setErr("상품명을 입력하세요.");
    if (!f.closeAt) return setErr("예약 마감 시각을 입력하세요.");
    if (!f.pickup) return setErr("픽업(출고)일을 선택하세요.");
    start(async () => {
      const fd = new FormData();
      if (f.id) fd.set("id", f.id);
      fd.set("name", f.name);
      fd.set("closeAt", f.closeAt);
      fd.set("pickupDate", f.pickup);
      fd.set("supplyPrice", f.price || "0");
      fd.set("inventoryItemId", f.invId);
      fd.set("stockFixed", f.invId && f.fixed ? "true" : "false");
      const res = await saveFlatProductAction({}, fd);
      if (res?.error) return setErr(res.error);
      reset();
      router.refresh();
    });
  };

  const del = (id: string, name: string) => {
    if (!confirm(`'${name}' 예약상품을 삭제할까요? (목록에서 숨겨져요)`)) return;
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      fd.set("deleted", "true");
      const res = await saveFlatProductAction({}, fd);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      if (f.id === id) reset();
      router.refresh();
    });
  };

  return (
    <>
      {/* 수정 폼 — 지난 목록에선 '수정'을 눌렀을 때만 열린다(등록 없음). */}
      {editing && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="section-label" style={{ marginBottom: 8 }}>
            예약상품 수정 (지난 상품)
          </div>
          {f.invId ? (
            <div className="flatinv__picked">
              <span>
                재고연동 · <b>{linkedName}</b>
              </span>
              <button
                type="button"
                className="btn btn--xs btn--ghost"
                onClick={() => {
                  setF((s) => ({ ...s, invId: "" }));
                  setInvSearch("");
                }}
              >
                연동 해제
              </button>
            </div>
          ) : (
            <div className="flatinv">
              <input
                className="input"
                value={invSearch}
                onChange={(e) => setInvSearch(e.target.value)}
                placeholder="재고 연동 검색 (선택) — 품목명"
              />
              {invSearch.trim() && (
                <div className="flatinv__results">
                  {invMatches.length === 0 ? (
                    <div className="flatinv__none">검색 결과 없음</div>
                  ) : (
                    invMatches.map((i) => (
                      <button
                        type="button"
                        key={i.id}
                        className="flatinv__opt"
                        onClick={() => {
                          pickInv(i.id);
                          setInvSearch("");
                        }}
                      >
                        <span>{i.name}</span>
                        <span className="flatinv__price">{won(i.supplyPrice)}원</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
          <input
            className="input"
            value={f.name}
            onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))}
            placeholder="상품명"
            maxLength={100}
            disabled={!!f.invId}
            style={{ marginBottom: 8 }}
          />
          <label className="resvflat__flabel">예약 마감 (시·분)</label>
          <input
            className="input"
            type="datetime-local"
            value={f.closeAt}
            onChange={(e) => setF((s) => ({ ...s, closeAt: e.target.value }))}
            style={{ marginBottom: 8 }}
          />
          <label className="resvflat__flabel">픽업(출고)일</label>
          <input
            className="input"
            type="date"
            value={f.pickup}
            onChange={(e) => setF((s) => ({ ...s, pickup: e.target.value }))}
            style={{ marginBottom: 8 }}
          />
          <MoneyInput value={f.price} onChange={(v) => setF((s) => ({ ...s, price: v }))} placeholder="점주 공급가" />
          {f.invId && (
            <label className="flatfix">
              <input
                type="checkbox"
                checked={f.fixed}
                onChange={(e) => setF((s) => ({ ...s, fixed: e.target.checked }))}
              />
              <span>
                <b>재고 고정</b> — 재고까지만 담기 허용(초과발주 금지)
                <span className="flatfix__hint">끄면 재고를 넘어서 담기고, 부족분은 본사가 납품처에 추가 주문</span>
              </span>
            </label>
          )}
          {err && (
            <div className="notice notice--error" style={{ marginTop: 8 }}>
              {err}
            </div>
          )}
          <div className="confirm__actions" style={{ marginTop: 10 }}>
            <button type="button" className="btn btn--xs btn--ghost" onClick={reset} disabled={pending}>
              취소
            </button>
            <button
              type="button"
              className="btn btn--xs btn--primary"
              onClick={submit}
              disabled={pending}
              style={{ flex: 1 }}
            >
              {pending ? "저장 중…" : "수정 저장"}
            </button>
          </div>
        </div>
      )}

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
              <div className="resvflat__acts">
                <button type="button" className="btn btn--xs btn--soft" onClick={() => startEdit(p)}>
                  수정
                </button>
                <button
                  type="button"
                  className="btn btn--xs btn--ghost"
                  onClick={() => del(p.id, p.name)}
                  disabled={pending}
                >
                  삭제
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
