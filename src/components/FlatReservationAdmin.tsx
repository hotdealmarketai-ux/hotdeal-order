"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoneyInput } from "./MoneyInput";
import { saveFlatProductAction } from "@/app/actions/reservation-flat";

export type FlatAdminRow = {
  id: string;
  name: string;
  pickupDate: string;
  supplyPrice: number;
  inventoryItemId: string;
  closeAtMs: number;
  closeAtLocal: string; // "YYYY-MM-DDTHH:MM:SS" (KST) — datetime-local 프리필
  totalQty: number;
  storeCount: number;
};
type Inv = { id: string; name: string; supplyPrice: number };

const won = (n: number) => n.toLocaleString("ko-KR");

function remainLabel(ms: number, nowMs: number): string {
  let s = Math.floor((ms - nowMs) / 1000);
  if (s <= 0) return "마감";
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  if (d > 0) return `${d}일 ${h}시간 남음`;
  return `${h}시간 ${m}분 ${s}초 남음`;
}

function Countdown({ ms }: { ms: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const closed = now >= ms;
  return (
    <span className={closed ? "resvflat__cd resvflat__cd--closed" : "resvflat__cd"}>
      {remainLabel(ms, now)}
    </span>
  );
}

const EMPTY = { id: "", name: "", closeAt: "", pickup: "", price: "", invId: "" };

// 관리자 예약발주 단일 목록 — 상품 등록(상품별 마감 시분초)·수정·삭제 + 마감 임박순 목록.
export function FlatReservationAdmin({
  products,
  inventoryItems,
}: {
  products: FlatAdminRow[];
  inventoryItems: Inv[];
}) {
  const router = useRouter();
  const [f, setF] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const editing = f.id !== "";

  const reset = () => {
    setF({ ...EMPTY });
    setErr("");
  };
  const startEdit = (p: FlatAdminRow) => {
    setErr("");
    setF({
      id: p.id,
      name: p.name,
      closeAt: p.closeAtLocal,
      pickup: p.pickupDate,
      price: String(p.supplyPrice),
      invId: p.inventoryItemId,
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pickInv = (id: string) => {
    if (!id) {
      setF((s) => ({ ...s, invId: "" }));
      return;
    }
    const inv = inventoryItems.find((i) => i.id === id);
    setF((s) => ({
      ...s,
      invId: id,
      name: inv?.name ?? s.name,
      price: inv ? String(inv.supplyPrice) : s.price,
    }));
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
      const res = await saveFlatProductAction({}, fd);
      if (res?.error) return setErr(res.error);
      reset();
      router.refresh();
    });
  };

  const del = (id: string, name: string) => {
    if (!confirm(`'${name}' 예약상품을 삭제할까요?`)) return;
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
      {/* 등록/수정 폼 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>
          {editing ? "예약상품 수정" : "예약상품 등록"}
        </div>
        <select
          className="input"
          value={f.invId}
          onChange={(e) => pickInv(e.target.value)}
          style={{ marginBottom: 8 }}
        >
          <option value="">직접 입력 (재고 연동 안 함)</option>
          {inventoryItems.map((i) => (
            <option key={i.id} value={i.id}>
              재고연동 · {i.name}
            </option>
          ))}
        </select>
        <input
          className="input"
          value={f.name}
          onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))}
          placeholder="상품명"
          maxLength={100}
          disabled={!!f.invId}
          style={{ marginBottom: 8 }}
        />
        <label className="resvflat__flabel">예약 마감 (시·분·초)</label>
        <input
          className="input"
          type="datetime-local"
          step={1}
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
        <MoneyInput
          value={f.price}
          onChange={(v) => setF((s) => ({ ...s, price: v }))}
          placeholder="점주 공급가"
        />
        {err && (
          <div className="notice notice--error" style={{ marginTop: 8 }}>
            {err}
          </div>
        )}
        <div className="confirm__actions" style={{ marginTop: 10 }}>
          {editing && (
            <button type="button" className="btn btn--xs btn--ghost" onClick={reset} disabled={pending}>
              취소
            </button>
          )}
          <button
            type="button"
            className="btn btn--xs btn--primary"
            onClick={submit}
            disabled={pending}
            style={{ flex: 1 }}
          >
            {pending ? "저장 중…" : editing ? "수정 저장" : "+ 등록"}
          </button>
        </div>
      </div>

      {/* 마감 임박순 목록 */}
      <div className="itemshead">
        <span className="itemshead__label">진행 중 예약상품</span>
        <span className="itemshead__count">{products.length}개</span>
      </div>
      {products.length === 0 ? (
        <div className="empty">
          <p>진행 중인 예약상품이 없어요. 위에서 등록해 주세요.</p>
        </div>
      ) : (
        <div className="resvflatwrap">
          {products.map((p) => (
            <div className="resvflat" key={p.id}>
              <div className="resvflat__main">
                <div className="resvflat__name">
                  {p.name}
                  {p.inventoryItemId ? <span className="resvflat__tag">재고연동</span> : null}
                </div>
                <div className="resvflat__meta">
                  픽업 {p.pickupDate} · 공급가 {won(p.supplyPrice)}원
                </div>
                <div className="resvflat__meta2">
                  <Countdown ms={p.closeAtMs} />
                  <span className="resvflat__agg">
                    취합 {p.totalQty}개 · {p.storeCount}점포
                  </span>
                </div>
              </div>
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
