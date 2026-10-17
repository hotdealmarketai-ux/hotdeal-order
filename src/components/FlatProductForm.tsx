"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoneyInput } from "./MoneyInput";
import { saveFlatProductAction } from "@/app/actions/reservation-flat";
import { FLAT_DESC_MAX, parseMinInput } from "@/lib/flat-qty-rule";
import { dowOf, labelDate } from "@/lib/date";

// 공산품 등록·수정 폼 하나 — 진행 중 목록(FlatReservationAdmin)과 마감된 목록(FlatClosedList)이 같이 쓴다.
//  · 새로 등록: 저장에 성공하면 상품명·공급가·연동·구성품만 비우고 마감·출고일·최소 수량·안내는 남긴다(연속 등록).
//    [초기화]를 누르면 전부 비운다.
//  · 수정·복사: 부모가 initial 로 상품 값을 넣어 다시 띄운다(key 를 바꿔 새로 그림). 복사는 id 없이 = 새 상품.
//  · 서버(saveFlatProductAction)가 돌려주는 error 는 저장 안 됨, warning 은 저장은 됐지만 알릴 말.

export type FlatInv = { id: string; name: string; supplyPrice: number };

// 폼에 채울 상품 값 — 관리자 목록 행이 모두 이 모양을 품는다.
// minPerStore·description 이 없는 행(옛 매핑)을 수정할 때는 두 칸을 보내지 않아 서버 값을 그대로 둔다.
export type FlatFormRow = {
  id: string;
  name: string;
  pickupDate: string; // 출고일(= 계산서 날짜)
  supplyPrice: number;
  inventoryItemId: string;
  closeAtLocal: string; // "YYYY-MM-DDTHH:MM" (KST)
  stockFixed: boolean; // 재고 고정(초과발주 금지) — 재고 연동 단일 상품만
  minPerStore?: number | null; // 지점당 최소 수량 MOQ(null = 없음)
  description?: string; // 점주 안내 한 줄
  components: { name: string; inventoryItemId: string; qtyPerUnit: number; supplyPrice: number }[];
};

type Comp = { name: string; invId: string; qtyPerUnit: string; price: string };
type Form = {
  id: string; // 수정할 상품 id("" = 새로 등록)
  name: string;
  closeDate: string; // 발주 마감 날짜 YYYY-MM-DD
  closeTime: string; // 발주 마감 시각 HH:MM
  pickup: string; // 출고일
  price: string;
  invId: string;
  fixed: boolean; // 재고 고정
  min: string; // 최소 수량("" = 없음)
  desc: string; // 안내 한 줄
  keepRule: boolean; // 규칙 값을 모르는 행을 수정 중 — 두 칸을 안 보내 서버 값 유지(칸을 고치면 false)
};

const won = (n: number) => n.toLocaleString("ko-KR");
const DEFAULT_CLOSE_TIME = "10:00"; // 날짜만 고르면 넣어 두는 마감 시각(실제 운영: 오전 10시 마감)

const BLANK: Form = {
  id: "",
  name: "",
  closeDate: "",
  closeTime: "",
  pickup: "",
  price: "",
  invId: "",
  fixed: false,
  min: "",
  desc: "",
  keepRule: false,
};

function formOf(row: FlatFormRow, copy: boolean): Form {
  const ruleKnown = row.minPerStore !== undefined;
  return {
    id: copy ? "" : row.id,
    name: row.name,
    closeDate: row.closeAtLocal.slice(0, 10),
    closeTime: row.closeAtLocal.slice(11, 16),
    pickup: row.pickupDate,
    price: String(row.supplyPrice),
    invId: row.inventoryItemId,
    fixed: row.stockFixed,
    min: row.minPerStore && row.minPerStore > 1 ? String(row.minPerStore) : "",
    desc: row.description ?? "",
    keepRule: !copy && !ruleKnown,
  };
}
const compsOf = (row: FlatFormRow | null): Comp[] =>
  (row?.components ?? []).map((c) => ({
    name: c.name,
    invId: c.inventoryItemId,
    qtyPerUnit: String(c.qtyPerUnit),
    price: String(c.supplyPrice),
  }));

export function FlatProductForm({
  inventoryItems,
  initial = null,
  allowNew = true,
  onClose,
}: {
  inventoryItems: FlatInv[];
  initial?: { row: FlatFormRow; copy: boolean } | null; // 수정(copy=false)·복사(copy=true)할 상품
  allowNew?: boolean; // false = 마감된 목록 — 빈 새 폼 대신 [닫기]
  onClose?: (msg?: { ok: string; warning?: string }) => void; // 취소·닫기, 수정 저장 성공(알릴 말)
}) {
  const router = useRouter();
  const [f, setF] = useState<Form>(() => (initial ? formOf(initial.row, initial.copy) : { ...BLANK }));
  const [comps, setComps] = useState<Comp[]>(() => compsOf(initial?.row ?? null));
  const [invSearch, setInvSearch] = useState("");
  const [compSearch, setCompSearch] = useState<Record<number, string>>({});
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ ok: string; warning?: string } | null>(null);
  const [pending, start] = useTransition();
  const editing = f.id !== "";
  const isSet = comps.length > 0; // 구성품이 1개 이상이면 세트 상품
  const set = (patch: Partial<Form>) => {
    setDone(null);
    setF((s) => ({ ...s, ...patch }));
  };
  const setRule = (patch: Partial<Pick<Form, "min" | "desc">>) => set({ ...patch, keepRule: false });

  const addComp = () => setComps((cs) => [...cs, { name: "", invId: "", qtyPerUnit: "1", price: "" }]);
  const removeComp = (i: number) => setComps((cs) => cs.filter((_, k) => k !== i));
  const updateComp = (i: number, patch: Partial<Comp>) =>
    setComps((cs) => cs.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  const pickCompInv = (i: number, invId: string) => {
    const inv = inventoryItems.find((x) => x.id === invId);
    updateComp(i, {
      invId,
      name: inv?.name ?? comps[i]?.name ?? "",
      price: inv ? String(inv.supplyPrice) : (comps[i]?.price ?? ""),
    });
    setCompSearch((s) => ({ ...s, [i]: "" }));
  };
  // 세트 공급가 = Σ(구성품 공급가 × 세트당 수량)
  const setTotal = comps.reduce(
    (s, c) => s + (parseInt(c.price || "0", 10) || 0) * (parseInt(c.qtyPerUnit || "1", 10) || 1),
    0,
  );

  const invMatches = invSearch.trim()
    ? inventoryItems.filter((i) => i.name.includes(invSearch.trim())).slice(0, 8)
    : [];
  const linkedName = f.invId ? (inventoryItems.find((i) => i.id === f.invId)?.name ?? "연동 품목") : "";
  const pickInv = (id: string) => {
    const inv = inventoryItems.find((i) => i.id === id);
    set({ invId: id, name: inv?.name ?? f.name, price: inv ? String(inv.supplyPrice) : f.price });
  };

  // [초기화] — 전부 비움(알림 체크는 켬)
  const clearAll = () => {
    setF({ ...BLANK });
    setComps([]);
    setCompSearch({});
    setInvSearch("");
    setErr("");
    setDone(null);
  };

  const submit = () => {
    setErr("");
    setDone(null);
    if (!f.name.trim()) return setErr(isSet ? "세트 이름을 넣어 주세요." : "상품명을 넣어 주세요.");
    if (!f.closeDate || !f.closeTime) return setErr("발주 마감 날짜와 시각을 넣어 주세요.");
    if (!f.pickup) return setErr("출고일을 골라 주세요.");
    if (isSet && comps.some((c) => !c.name.trim())) return setErr("구성품 품목명을 모두 넣어 주세요.");
    const min = parseMinInput(f.min);
    if ("error" in min) return setErr(min.error);
    // 재고 고정은 재고 연동 단일 상품만(세트·수기 상품은 늘 꺼짐 — 서버도 같은 규칙)
    const canFix = !isSet && !!f.invId;
    const wasEditing = editing;
    start(async () => {
      const fd = new FormData();
      if (f.id) fd.set("id", f.id);
      fd.set("name", f.name);
      fd.set("closeAt", `${f.closeDate}T${f.closeTime}`);
      fd.set("pickupDate", f.pickup);
      fd.set("supplyPrice", f.price || "0"); // 세트면 서버가 구성품 합으로 덮어씀
      fd.set("inventoryItemId", isSet ? "" : f.invId);
      fd.set("stockFixed", canFix && f.fixed ? "true" : "false");
      // 이 폼은 구성품을 '관리'하므로 항상 보낸다(비어있으면 "[]" = 단일 상품으로 명시 → 세트↔단일 전환도 반영).
      fd.set(
        "components",
        JSON.stringify(
          comps.map((c) => ({
            name: c.name.trim(),
            inventoryItemId: c.invId,
            qtyPerUnit: c.qtyPerUnit,
            supplyPrice: c.price,
          })),
        ),
      );
      if (!f.keepRule) {
        fd.set("minPerStore", f.min);
        fd.set("description", f.desc);
      }
      const res = await saveFlatProductAction({}, fd);
      if (res?.error) return setErr(res.error);
      router.refresh();
      if (wasEditing) {
        onClose?.({ ok: "저장했어요.", warning: res.warning });
        return;
      }
      // 연속 등록 — 상품마다 다른 칸만 비운다(마감·출고일·최소 수량·안내는 그대로).
      setF((s) => ({ ...s, name: "", price: "", invId: "", fixed: false }));
      setComps([]);
      setCompSearch({});
      setInvSearch("");
      setDone({ ok: "등록했어요.", warning: res.warning });
    });
  };

  const pickupDow = f.pickup ? dowOf(f.pickup) : -1;

  return (
    <div className="card gspf">
      <div className="section-label" style={{ marginBottom: 8 }}>
        {editing ? "공산품 수정" : "공산품 등록"}
      </div>
      {/* 단일 상품일 때만 재고연동 검색 노출(세트는 아래 '세트 구성품'이 각자 연동). */}
      {!isSet &&
        (f.invId ? (
          <div className="flatinv__picked">
            <span>
              재고 연동 · <b>{linkedName}</b>
            </span>
            <button
              type="button"
              className="btn btn--xs btn--ghost"
              onClick={() => {
                set({ invId: "" });
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
              placeholder="재고 연동 (선택)"
            />
            {invSearch.trim() && (
              <div className="flatinv__results">
                {invMatches.length === 0 ? (
                  <div className="flatinv__none">검색 결과가 없어요.</div>
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
        onChange={(e) => set({ name: e.target.value })}
        placeholder={isSet ? "세트 이름" : "상품명 · 규격"}
        maxLength={100}
        disabled={!!f.invId}
        style={{ marginBottom: 8 }}
      />

      <div className="gspf__row">
        <div>
          <label className="resvflat__flabel">발주 마감 날짜</label>
          <input
            className="input"
            type="date"
            value={f.closeDate}
            onChange={(e) => {
              const v = e.target.value;
              // 날짜만 고르고 시각이 비어 있으면 오전 10시를 넣어 둔다.
              set({ closeDate: v, ...(v && !f.closeTime ? { closeTime: DEFAULT_CLOSE_TIME } : {}) });
            }}
          />
          {f.closeDate && <div className="gspf__day">{labelDate(f.closeDate)}</div>}
        </div>
        <div>
          <label className="resvflat__flabel">시각</label>
          <input
            className="input"
            type="time"
            value={f.closeTime}
            onChange={(e) => set({ closeTime: e.target.value })}
          />
        </div>
      </div>
      <div style={{ marginBottom: 8 }}>
        <label className="resvflat__flabel">출고일</label>
        <input className="input" type="date" value={f.pickup} onChange={(e) => set({ pickup: e.target.value })} />
        {f.pickup && (
          <div className={`gspf__day${pickupDow === 0 ? " is-bad" : ""}`}>
            {labelDate(f.pickup)}
            {pickupDow === 0 ? " · 일요일은 출고가 없어요" : ""}
          </div>
        )}
      </div>
      {isSet ? (
        <div className="resvflat__meta" style={{ marginBottom: 2 }}>
          세트 공급가 <b>{won(setTotal)}원</b>
        </div>
      ) : (
        <MoneyInput value={f.price} onChange={(v) => set({ price: v })} placeholder="공급가" />
      )}

      {/* 최소 수량(MOQ) — 빈칸 = 없음. 최소 이상이면 몇 개를 넣든 상관없다. */}
      <div style={{ marginTop: 8 }}>
        <label className="resvflat__flabel">최소 수량</label>
        <input
          className="input"
          inputMode="numeric"
          value={f.min}
          onChange={(e) => setRule({ min: e.target.value.replace(/\D/g, "").slice(0, 5) })}
          placeholder="없음"
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <label className="resvflat__flabel">안내 문구</label>
        <input
          className="input"
          value={f.desc}
          onChange={(e) => setRule({ desc: e.target.value })}
          placeholder="예: 제조사 사정으로 1~2일 늦어질 수 있어요"
          maxLength={FLAT_DESC_MAX}
        />
      </div>

      {/* 세트 구성품 — 여러 상품을 묶어 하나의 세트로. 비우면 단일 상품. 개수 제한 없음. */}
      <div style={{ marginTop: 10, borderTop: "0.5px solid var(--border)", paddingTop: 10 }}>
        <label className="resvflat__flabel" style={{ display: "block", marginBottom: 6 }}>
          세트 구성품 {isSet ? `${comps.length}개` : "(선택)"}
        </label>
        {comps.map((c, i) => {
          const cq = (compSearch[i] ?? "").trim();
          const matches = cq ? inventoryItems.filter((x) => x.name.includes(cq)).slice(0, 6) : [];
          const cLinkedName = c.invId ? (inventoryItems.find((x) => x.id === c.invId)?.name ?? "연동 품목") : "";
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
                  <span>
                    재고 연동 · <b>{cLinkedName}</b>
                  </span>
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
                    placeholder="재고 연동 (선택)"
                  />
                  {cq && (
                    <div className="flatinv__results">
                      {matches.length === 0 ? (
                        <div className="flatinv__none">검색 결과가 없어요.</div>
                      ) : (
                        matches.map((m) => (
                          <button type="button" key={m.id} className="flatinv__opt" onClick={() => pickCompInv(i, m.id)}>
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
                    inputMode="numeric"
                    value={c.qtyPerUnit}
                    onChange={(e) => updateComp(i, { qtyPerUnit: e.target.value.replace(/\D/g, "").slice(0, 4) })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label className="resvflat__flabel">공급가</label>
                  <MoneyInput value={c.price} onChange={(v) => updateComp(i, { price: v })} placeholder="공급가" />
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn--xs btn--soft" onClick={addComp}>
          + 구성품
        </button>
      </div>

      {/* 재고 고정 — 재고 연동 단일 상품만. 켜면 재고까지만, 끄면(기본) 초과발주 허용. */}
      {!isSet && f.invId && (
        <label className="flatfix">
          <input type="checkbox" checked={f.fixed} onChange={(e) => set({ fixed: e.target.checked })} />
          <span>
            <b>재고 고정</b>
            <span className="flatfix__hint">재고 수량까지만 발주할 수 있어요.</span>
          </span>
        </label>
      )}
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      {done && (
        <div className="notice notice--ok" style={{ marginTop: 8 }}>
          {done.ok}
        </div>
      )}
      {done?.warning && <div className="gsp-note gsp-note--warn">{done.warning}</div>}
      <div className="confirm__actions" style={{ marginTop: 10 }}>
        {editing || !allowNew ? (
          <button type="button" className="btn btn--xs btn--ghost" onClick={() => onClose?.()} disabled={pending}>
            {editing ? "취소" : "닫기"}
          </button>
        ) : (
          <button type="button" className="btn btn--xs btn--ghost" onClick={clearAll} disabled={pending}>
            초기화
          </button>
        )}
        <button
          type="button"
          className="btn btn--xs btn--primary"
          onClick={submit}
          disabled={pending}
          style={{ flex: 1 }}
        >
          {pending ? "저장 중…" : editing ? "저장" : "등록"}
        </button>
      </div>
    </div>
  );
}
