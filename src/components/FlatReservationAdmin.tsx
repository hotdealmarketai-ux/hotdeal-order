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
  closeAtLocal: string; // "YYYY-MM-DDTHH:MM" (KST) — datetime-local 프리필(시·분)
  stockFixed: boolean; // 재고 고정(초과발주 금지)
  totalQty: number;
  storeCount: number;
  components: { name: string; inventoryItemId: string; qtyPerUnit: number; supplyPrice: number }[];
};
type Inv = { id: string; name: string; supplyPrice: number };
type Comp = { name: string; invId: string; qtyPerUnit: string; price: string };

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

const EMPTY = {
  id: "",
  name: "",
  closeAt: "",
  pickup: "",
  price: "",
  invId: "",
  fixed: false, // 재고 고정(초과발주 금지)
};

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
  const [comps, setComps] = useState<Comp[]>([]);
  const [compSearch, setCompSearch] = useState<Record<number, string>>({});
  const [pending, start] = useTransition();
  const editing = f.id !== "";
  const isSet = comps.length > 0; // 구성품이 1개 이상이면 세트 상품

  const addComp = () => setComps((cs) => [...cs, { name: "", invId: "", qtyPerUnit: "1", price: "" }]);
  const removeComp = (i: number) => setComps((cs) => cs.filter((_, k) => k !== i));
  const updateComp = (i: number, patch: Partial<Comp>) =>
    setComps((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const pickCompInv = (i: number, invId: string) => {
    const inv = inventoryItems.find((x) => x.id === invId);
    updateComp(i, {
      invId,
      name: inv?.name ?? comps[i]?.name ?? "",
      price: inv ? String(inv.supplyPrice) : comps[i]?.price ?? "",
    });
    setCompSearch((s) => ({ ...s, [i]: "" }));
  };
  // 세트 공급가 = Σ(구성품 공급가 × 세트당 수량)
  const setTotal = comps.reduce(
    (s, c) => s + (parseInt(c.price || "0", 10) || 0) * (parseInt(c.qtyPerUnit || "1", 10) || 1),
    0,
  );

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
    setComps([]);
    setCompSearch({});
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
      fixed: p.stockFixed,
    });
    setComps(
      (p.components ?? []).map((c) => ({
        name: c.name,
        invId: c.inventoryItemId,
        qtyPerUnit: String(c.qtyPerUnit),
        price: String(c.supplyPrice),
      })),
    );
    setCompSearch({});
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
    if (!f.name.trim()) return setErr(isSet ? "세트 이름을 입력하세요." : "상품명을 입력하세요.");
    if (!f.closeAt) return setErr("예약 마감 시각을 입력하세요.");
    if (!f.pickup) return setErr("픽업(출고)일을 선택하세요.");
    if (isSet && comps.some((c) => !c.name.trim())) return setErr("구성품 품목명을 모두 입력하세요.");
    const anyLinked = isSet ? comps.some((c) => c.invId) : !!f.invId;
    start(async () => {
      const fd = new FormData();
      if (f.id) fd.set("id", f.id);
      fd.set("name", f.name);
      fd.set("closeAt", f.closeAt);
      fd.set("pickupDate", f.pickup);
      fd.set("supplyPrice", f.price || "0"); // 세트면 서버가 구성품 합으로 덮어씀
      fd.set("inventoryItemId", isSet ? "" : f.invId);
      fd.set("stockFixed", anyLinked && f.fixed ? "true" : "false");
      // 이 폼은 구성품을 '관리'하므로 항상 보낸다(비어있으면 "[]" = 단일 상품으로 명시 → 세트↔단일 전환도 반영).
      fd.set(
        "components",
        JSON.stringify(
          comps.map((c) => ({
            name: c.name.trim(),
            inventoryItemId: c.invId,
            qtyPerUnit: parseInt(c.qtyPerUnit || "1", 10) || 1,
            supplyPrice: parseInt(c.price || "0", 10) || 0,
          })),
        ),
      );
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
          {p.components.length > 0 ? (
            <span className="resvflat__tag">세트 {p.components.length}품</span>
          ) : p.inventoryItemId ? (
            <span className="resvflat__tag">재고연동</span>
          ) : null}
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
        {/* 단일 상품일 때만 재고연동 검색 노출(세트는 아래 '세트 구성품'이 각자 연동). */}
        {!isSet && (f.invId ? (
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
        ))}
        <input
          className="input"
          value={f.name}
          onChange={(e) => setF((s) => ({ ...s, name: e.target.value }))}
          placeholder={isSet ? "세트 이름 (예: 추석 선물세트 A)" : "상품명"}
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
        {!isSet && (
          <MoneyInput
            value={f.price}
            onChange={(v) => setF((s) => ({ ...s, price: v }))}
            placeholder="점주 공급가"
          />
        )}

        {/* 세트 구성품 — 여러 상품을 묶어 하나의 세트로. 비우면 단일 상품. 개수 제한 없음. */}
        <div style={{ marginTop: 10, borderTop: "0.5px solid var(--border)", paddingTop: 10 }}>
          <label className="resvflat__flabel" style={{ display: "block", marginBottom: 6 }}>
            세트 구성품 {isSet ? `(${comps.length}개 · 세트가 ${won(setTotal)}원)` : "(선택 — 묶음 상품일 때)"}
          </label>
          {comps.map((c, i) => {
            const q = (compSearch[i] ?? "").trim();
            const matches = q ? inventoryItems.filter((x) => x.name.includes(q)).slice(0, 6) : [];
            const linkedName = c.invId
              ? inventoryItems.find((x) => x.id === c.invId)?.name ?? "연동 품목"
              : "";
            return (
              <div
                key={i}
                style={{ border: "0.5px solid var(--border)", borderRadius: 8, padding: 8, marginBottom: 8 }}
              >
                <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                  <input
                    className="input"
                    style={{ flex: 1 }}
                    value={c.name}
                    onChange={(e) => updateComp(i, { name: e.target.value })}
                    placeholder="품목명"
                    maxLength={100}
                    disabled={!!c.invId}
                  />
                  <button type="button" className="btn btn--xs btn--ghost" onClick={() => removeComp(i)}>
                    삭제
                  </button>
                </div>
                {c.invId ? (
                  <div className="flatinv__picked" style={{ marginBottom: 6 }}>
                    <span>재고연동 · <b>{linkedName}</b></span>
                    <button type="button" className="btn btn--xs btn--ghost" onClick={() => updateComp(i, { invId: "" })}>
                      연동 해제
                    </button>
                  </div>
                ) : (
                  <div className="flatinv" style={{ marginBottom: 6 }}>
                    <input
                      className="input"
                      value={compSearch[i] ?? ""}
                      onChange={(e) => setCompSearch((s) => ({ ...s, [i]: e.target.value }))}
                      placeholder="재고 연동 검색 (선택) — 품목명"
                    />
                    {q && (
                      <div className="flatinv__results">
                        {matches.length === 0 ? (
                          <div className="flatinv__none">검색 결과 없음</div>
                        ) : (
                          matches.map((m) => (
                            <button
                              type="button"
                              key={m.id}
                              className="flatinv__opt"
                              onClick={() => pickCompInv(i, m.id)}
                            >
                              <span>{m.name}</span>
                              <span className="flatinv__price">{won(m.supplyPrice)}원</span>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div style={{ display: "flex", gap: 6 }}>
                  <div style={{ width: 110 }}>
                    <label className="resvflat__flabel">세트당 수량</label>
                    <input
                      className="input"
                      type="number"
                      min={1}
                      value={c.qtyPerUnit}
                      onChange={(e) => updateComp(i, { qtyPerUnit: e.target.value })}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="resvflat__flabel">공급가 {c.invId ? "(연동 자동·수정가능)" : ""}</label>
                    <MoneyInput
                      value={c.price}
                      onChange={(v) => updateComp(i, { price: v })}
                      placeholder="구성품 공급가"
                    />
                  </div>
                </div>
              </div>
            );
          })}
          <button type="button" className="btn btn--xs btn--soft" onClick={addComp}>
            + 구성품 추가
          </button>
        </div>
        {/* 재고 고정 — 연동(단일/세트 구성품) 있을 때만. 켜면 재고까지만, 끄면(기본) 초과발주 허용. */}
        {(f.invId || (isSet && comps.some((c) => c.invId))) && (
          <label className="flatfix">
            <input
              type="checkbox"
              checked={f.fixed}
              onChange={(e) => setF((s) => ({ ...s, fixed: e.target.checked }))}
            />
            <span>
              <b>재고 고정</b> — 재고까지만 담기 허용(초과발주 금지)
              <span className="flatfix__hint">
                끄면 재고를 넘어서 담기고, 부족분은 본사가 납품처에 추가 주문
              </span>
            </span>
          </label>
        )}
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
