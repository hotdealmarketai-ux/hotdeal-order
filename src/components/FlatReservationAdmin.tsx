"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
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

// 1초마다 갱신되는 현재시각.
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ms → KST 달력 날짜(YYYY-MM-DD). '오늘 마감' 섹터 분리에 사용.
function kstDateStr(ms: number): string {
  return new Date(ms + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function Countdown({ ms }: { ms: number }) {
  const now = useNow();
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
  const [invSearch, setInvSearch] = useState("");
  const [pending, start] = useTransition();
  const editing = f.id !== "";

  const invMatches = invSearch.trim()
    ? inventoryItems
        .filter((i) => i.name.includes(invSearch.trim()))
        .slice(0, 8)
    : [];
  const linkedName = f.invId
    ? (inventoryItems.find((i) => i.id === f.invId)?.name ?? "연동 품목")
    : "";

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

  const now = useNow();
  const todayStr = kstDateStr(now);
  const todayList = products.filter((p) => kstDateStr(p.closeAtMs) === todayStr);
  const laterList = products.filter((p) => kstDateStr(p.closeAtMs) !== todayStr);

  const row = (p: FlatAdminRow) => (
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
          <Countdown ms={p.closeAtMs} />
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
  );

  return (
    <>
      {/* 등록/수정 폼 */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="section-label" style={{ marginBottom: 8 }}>
          {editing ? "예약상품 수정" : "예약상품 등록"}
        </div>
        {/* 재고연동 — 품목이 많아 드롭다운 대신 검색해서 선택 */}
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

      {/* '오늘 마감' / '마감 여유' 섹터. 각 섹터 안은 서버 정렬(마감 임박순 + ㄱㄴㄷ) 유지. */}
      <div className="itemshead">
        <span className="itemshead__label">진행 중 예약상품</span>
        <span className="itemshead__count">{products.length}개</span>
      </div>
      {products.length === 0 ? (
        <div className="empty">
          <p>진행 중인 예약상품이 없어요. 위에서 등록해 주세요.</p>
        </div>
      ) : (
        <>
          {todayList.length > 0 && (
            <section className="rsec">
              <div className="rsec__head rsec__head--today">오늘 마감</div>
              <div className="resvflatwrap">{todayList.map(row)}</div>
            </section>
          )}
          {laterList.length > 0 && (
            <section className="rsec">
              <div className="rsec__head">마감 여유</div>
              <div className="resvflatwrap">{laterList.map(row)}</div>
            </section>
          )}
        </>
      )}
    </>
  );
}
