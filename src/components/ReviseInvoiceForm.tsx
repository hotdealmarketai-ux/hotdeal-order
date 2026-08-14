"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import { reviseInvoiceAction, type InvoiceFormState } from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";
import { MoneyInput } from "./MoneyInput";
import { CATEGORIES, type Category } from "@/lib/constants";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { rankStockMatches } from "@/lib/stock-match";
import { TaxToggle } from "./TaxToggle";
import { vatBreakdown, defaultTaxFor } from "@/lib/tax";

type Row = {
  id: number;
  name: string;
  qty: string;
  unitPrice: string;
  inventoryItemId: string; // 공구칸 재고현황 연동 상품 id(있으면)
  tax: string; // 과세/면세/미선택
  unitPerBox: string; // 채움채 낱개환산 마커(DB 스냅샷 보존, 이름 재추정 금지)
};

export type InvOption = { id: string; name: string; supplyPrice: number; qty: number; tax: string };

export type ReviseInitialItem = {
  category: Category;
  name: string;
  qty: string;
  unitPrice: string;
  inventoryItemId?: string;
  tax?: string;
  unitPerBox?: string; // 채움채 낱개환산 마커 — 레거시(박스)=0, 신규(낱개)=perBox. 수정 시 그대로 보존해야 재환산 정합.
};

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());
}

// 서버(cleanItems)와 동일한 엄격 파싱 — 형식이 아니면 금액을 표시하지 않는다.
function rowAmount(r: Row): number {
  const qty = parseQtyStrict(r.qty);
  const price = parsePriceStrict(r.unitPrice);
  if (qty == null || price == null) return 0;
  return Math.round(qty * price);
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

// 입금대기(ISSUED) 계산서를 제자리에서 고쳐 재발송. '계산서 수정' 버튼 → 편집 → 확인 → 재발송.
// 기존 계산서를 지우지 않고 같은 계산서를 갱신한다(점주 알림/링크 유지·중복 없음).
// 공구(TOOL)는 계산서 발행과 동일하게 재고현황 검색·연동(이름·공급가 자동채움 + 연동 id 유지) 지원.
export function ReviseInvoiceForm({
  invoiceId,
  date,
  categories,
  initialItems,
  invOptions = [],
  taxRequired = true,
}: {
  invoiceId: string;
  date: string;
  categories: Category[];
  initialItems: ReviseInitialItem[];
  invOptions?: InvOption[];
  // 레거시 계산서(과세/면세 기능 이전 발행분)는 수정 시 과세/면세를 강제하지 않는다(false).
  taxRequired?: boolean;
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({
    id: ++uid.current,
    name: "",
    qty: "",
    unitPrice: "",
    inventoryItemId: "",
    tax: "",
    unitPerBox: "", // 수기 추가 행 = 0(박스/일반)
  });

  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [acRow, setAcRow] = useState<number | null>(null); // 공구 자동완성 드롭다운 열린 행
  // 연동 재고 id/이름 → 과세/면세(하드코딩). 저장된 tax가 없을 때 연동·이름일치값을 채운다.
  const taxByInvId = useMemo(
    () => new Map(invOptions.map((o) => [o.id, o.tax])),
    [invOptions],
  );
  const taxByName = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of invOptions) {
      const k = o.name.trim();
      if (k && !m.has(k)) m.set(k, o.tax);
    }
    return m;
  }, [invOptions]);
  const [rowsByCat, setRowsByCat] = useState<Record<string, Row[]>>(() => {
    const init: Record<string, Row[]> = {};
    for (const c of categories) init[c] = [];
    for (const it of initialItems) {
      if (!init[it.category]) continue;
      const invId = it.inventoryItemId ?? "";
      // 레거시(taxRequired=false)는 저장된 tax만 사용(빈값 유지) — 재고 매칭으로 과세/면세를 무단 주입하지 않는다.
      const tax = taxRequired
        ? it.tax ||
          defaultTaxFor(it.category) ||
          (invId ? taxByInvId.get(invId) ?? "" : "") ||
          taxByName.get(it.name.trim()) ||
          ""
        : it.tax || "";
      init[it.category].push({
        id: ++uid.current,
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
        inventoryItemId: invId,
        tax,
        unitPerBox: it.unitPerBox ?? "", // DB 스냅샷 그대로 보존(레거시=0, 낱개=perBox). 이름으로 재추정하지 않음.
      });
    }
    for (const c of categories) init[c].push(newRow());
    return init;
  });
  const [state, formAction] = useActionState<InvoiceFormState, FormData>(
    reviseInvoiceAction,
    {},
  );

  // 재고연동 행의 현재 실물 재고(출고 후 잔량 표시용) — inventoryItemId → qty.
  const stockById = useMemo(
    () => new Map(invOptions.map((o) => [o.id, o.qty])),
    [invOptions],
  );
  // 이름 유사매칭(계산서 발행과 동일 rankStockMatches). 1글자↑부터.
  function invMatches(q: string): InvOption[] {
    const query = q.trim();
    if (query.length < 1 || invOptions.length === 0) return [];
    const ranked = rankStockMatches(query, invOptions, 8).filter((r) => r.score >= 8);
    const byId = new Map(invOptions.map((o) => [o.id, o]));
    return ranked.map((r) => byId.get(r.id)).filter((o): o is InvOption => !!o);
  }

  // 채운 줄 + 편집 중 줄만 남기고 후행 빈 줄 하나 유지(빈 칸 자동 축소, 최소 1줄).
  function normalizeRows(list: Row[], editingId?: number): Row[] {
    const kept = list.filter((r) => isFilled(r) || r.id === editingId);
    const last = kept[kept.length - 1];
    if (!last || isFilled(last)) kept.push(newRow());
    return kept;
  }

  function updateRow(cat: Category, id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[cat].map((r) =>
        r.id === id
          ? {
              ...r,
              [field]: value,
              // 과일·야채 행을 채우기 시작하면 면세 자동(신규 계산서 수정 시). 레거시(taxRequired=false)·tax 토글 조작은 제외.
              ...(taxRequired && field !== "tax" && !r.tax ? { tax: defaultTaxFor(cat) } : {}),
            }
          : r,
      );
      return { ...prev, [cat]: normalizeRows(list, id) };
    });
  }

  // 공구 이름 직접 입력 — 연동 해제(수기), 자동완성 후보 갱신. 이름이 바뀌면 과세/면세도 재평가(이전 연동값 잔존 방지).
  function onToolName(cat: Category, id: number, value: string) {
    setConfirming(false);
    setAcRow(value.trim() ? id : null);
    setRowsByCat((prev) => {
      const list = prev[cat].map((r) =>
        r.id === id
          ? {
              ...r,
              name: value,
              inventoryItemId: "",
              tax: taxRequired ? taxByName.get(value.trim()) || "" : "",
            }
          : r,
      );
      return { ...prev, [cat]: normalizeRows(list, id) };
    });
  }

  // 드롭다운에서 상품 선택 — 이름·점주공급가·연동 id를 한 번에 채운다.
  function pickInvOption(cat: Category, id: number, opt: InvOption) {
    setConfirming(false);
    setAcRow(null);
    setRowsByCat((prev) => {
      const list = prev[cat].map((r) =>
        r.id === id
          ? {
              ...r,
              name: opt.name,
              unitPrice: String(opt.supplyPrice),
              inventoryItemId: opt.id,
              tax: opt.tax || r.tax,
            }
          : r,
      );
      return { ...prev, [cat]: normalizeRows(list, id) };
    });
  }

  // 항목 한 줄 통째로 삭제(맨 끝 ✕) — 백스페이스 없이 즉시 제거.
  function removeRow(cat: Category, id: number) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[cat].filter((r) => r.id !== id);
      return { ...prev, [cat]: normalizeRows(list) };
    });
  }

  const payload = useMemo(
    () =>
      categories.flatMap((c) =>
        (rowsByCat[c] ?? [])
          .filter(isFilled)
          .map((r) => ({
            category: c,
            name: r.name,
            qty: r.qty,
            unitPrice: r.unitPrice,
            inventoryItemId: r.inventoryItemId,
            tax: r.tax,
            unitPerBox: r.unitPerBox, // 낱개환산 마커 보존 전달(레거시 박스가 낱개로 오각인되지 않게)
          })),
      ),
    [categories, rowsByCat],
  );

  const subtotals = useMemo(() => {
    const m: Record<string, { count: number; sum: number }> = {};
    for (const c of categories) {
      const rows = (rowsByCat[c] ?? []).filter(isFilled);
      m[c] = { count: rows.length, sum: rows.reduce((n, r) => n + rowAmount(r), 0) };
    }
    return m;
  }, [categories, rowsByCat]);

  const total = categories.reduce((n, c) => n + (subtotals[c]?.sum ?? 0), 0);
  const totalCount = categories.reduce((n, c) => n + (subtotals[c]?.count ?? 0), 0);

  // 재발송 전 검증 — 서버(cleanItems strict)와 동일 규칙.
  function validate(): boolean {
    for (const c of categories) {
      for (const r of (rowsByCat[c] ?? []).filter(isFilled)) {
        if (!r.name.trim()) {
          setLocalError("품목명이 비어 있는 줄이 있어요.");
          return false;
        }
        if (parseQtyStrict(r.qty) == null) {
          setLocalError(`'${r.name}' 수량을 확인해 주세요. (숫자만, 예: 4 또는 0.5)`);
          return false;
        }
        if (parsePriceStrict(r.unitPrice) == null) {
          setLocalError(`'${r.name}' 단가를 확인해 주세요. (원 단위 숫자만)`);
          return false;
        }
        if (taxRequired && r.tax !== "TAXABLE" && r.tax !== "EXEMPT") {
          setLocalError(`'${r.name}' 과세/면세를 선택해 주세요.`);
          return false;
        }
      }
    }
    if (totalCount === 0) {
      setLocalError("품목을 한 개 이상 입력하세요.");
      return false;
    }
    setLocalError("");
    return true;
  }

  if (!editing) {
    return (
      <div style={{ marginTop: 16 }}>
        <button
          type="button"
          className="btn btn--ghost btn--block"
          onClick={() => setEditing(true)}
        >
          계산서 수정
        </button>
        <p className="hint center" style={{ marginTop: 8 }}>
          입금대기 중인 계산서를 고쳐 다시 보냅니다. 같은 계산서가 갱신되고 점주에게
          &lsquo;계산서가 수정되었습니다&rsquo; 알림이 가요.
        </p>
      </div>
    );
  }

  return (
    <form
      action={formAction}
      style={{ marginTop: 16 }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.target as HTMLElement).tagName === "INPUT") {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      <div className="notice notice--ai" style={{ marginBottom: 12 }}>
        {date} 출고분 계산서를 수정하는 중이에요. 다 고치면 아래 &lsquo;수정해서 다시
        보내기&rsquo;를 눌러 주세요.
      </div>

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      {categories.map((c) => {
        const sub = subtotals[c] ?? { count: 0, sum: 0 };
        return (
          <div className="invcat" key={c}>
            <div className="invcat__head">
              <span className="chip">{CATEGORIES[c].label}</span>
              {sub.sum > 0 && <span className="invcat__sum">{fmt(sub.sum)}원</span>}
            </div>
            <div className="invcols">
              <span>품목</span>
              <span>수량</span>
              <span>단가</span>
              <span style={{ textAlign: "right" }}>금액</span>
            </div>
            {(rowsByCat[c] ?? []).map((r) => {
              const amt = rowAmount(r);
              return (
                <div className="invrow" key={r.id}>
                  {c === "TOOL" ? (
                    <div className="invac">
                      <input
                        className="input"
                        value={r.name}
                        onChange={(e) => onToolName(c, r.id, e.target.value)}
                        onFocus={() => r.name.trim() && setAcRow(r.id)}
                        onBlur={() =>
                          setTimeout(
                            () => setAcRow((cur) => (cur === r.id ? null : cur)),
                            150,
                          )
                        }
                        placeholder="품목(재고 검색)"
                        autoComplete="off"
                      />
                      {acRow === r.id &&
                        (() => {
                          const ms = invMatches(r.name);
                          return ms.length > 0 ? (
                            <div className="invac__list">
                              {ms.map((o) => (
                                <button
                                  type="button"
                                  key={o.id}
                                  className="invac__item"
                                  onMouseDown={(e) => {
                                    e.preventDefault();
                                    pickInvOption(c, r.id, o);
                                  }}
                                >
                                  <span className="invac__name">{o.name}</span>
                                  <span className="invac__price">
                                    {o.supplyPrice.toLocaleString("ko-KR")}원
                                  </span>
                                </button>
                              ))}
                            </div>
                          ) : null;
                        })()}
                    </div>
                  ) : (
                    <input
                      className="input"
                      value={r.name}
                      onChange={(e) => updateRow(c, r.id, "name", e.target.value)}
                      placeholder="품목"
                    />
                  )}
                  <input
                    className="input"
                    inputMode="decimal"
                    value={r.qty}
                    onChange={(e) => updateRow(c, r.id, "qty", e.target.value)}
                    placeholder="수량"
                  />
                  <MoneyInput
                    value={r.unitPrice}
                    onChange={(raw) => updateRow(c, r.id, "unitPrice", raw)}
                    placeholder="단가"
                  />
                  <span className="invrow__amt">{amt > 0 ? fmt(amt) : ""}</span>
                  {isFilled(r) && (
                    <button
                      type="button"
                      className="invrow__x"
                      onClick={() => removeRow(c, r.id)}
                      aria-label="이 항목 지우기"
                      title="이 항목 지우기"
                    >
                      ✕
                    </button>
                  )}
                  {taxRequired && isFilled(r) && (
                    <div className="invrow__tax">
                      <TaxToggle
                        value={r.tax}
                        onChange={(v) => updateRow(c, r.id, "tax", v)}
                      />
                      {r.tax === "TAXABLE" && amt > 0 && (
                        <span className="invrow__vat">
                          세액 {fmt(vatBreakdown(amt, "TAXABLE").vat)} · 공급가액{" "}
                          {fmt(vatBreakdown(amt, "TAXABLE").supply)}
                        </span>
                      )}
                    </div>
                  )}
                  {/* 재고연동 행 — 입력칸 밑에 현재 재고 + 이 수량 출고 시 잔량. */}
                  {c === "TOOL" &&
                    r.inventoryItemId &&
                    stockById.has(r.inventoryItemId) &&
                    (() => {
                      const base = stockById.get(r.inventoryItemId) ?? 0;
                      const entered = parseQtyStrict(r.qty);
                      const after = entered != null ? base - entered : null;
                      return (
                        <div className="invrow__stock">
                          남은 재고 <b>{base.toLocaleString("ko-KR")}개</b>
                          {after != null && (
                            <>
                              {" · 출고 시 "}
                              <b
                                className={
                                  after < 0 ? "invrow__stock--over" : "invrow__stock--after"
                                }
                              >
                                {after.toLocaleString("ko-KR")}개
                              </b>
                              {" 남음"}
                            </>
                          )}
                        </div>
                      );
                    })()}
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="invtotal">
        <span>합계 · 자동 계산 ({totalCount}건)</span>
        <b>{fmt(total)}원</b>
      </div>

      {!confirming ? (
        <div className="confirm__actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setEditing(false);
              setLocalError("");
            }}
          >
            그만두기
          </button>
          <button
            type="button"
            className="btn btn--primary"
            style={{ flex: 1.4 }}
            onClick={() => {
              if (validate()) setConfirming(true);
            }}
          >
            수정해서 다시 보내기
          </button>
        </div>
      ) : (
        <div className="confirm">
          <div className="confirm__title">이대로 수정해서 다시 보낼까요?</div>
          {categories
            .filter((c) => (subtotals[c]?.count ?? 0) > 0)
            .map((c) => {
              const rows = (rowsByCat[c] ?? []).filter(isFilled);
              return (
                <div className="invcat" key={c}>
                  <div className="invcat__head">
                    <span className="chip">{CATEGORIES[c].label}</span>
                    <span className="invcat__sum">{fmt(subtotals[c].sum)}원</span>
                  </div>
                  {rows.map((r) => (
                    <div className="invline" key={r.id}>
                      <span>
                        {r.name}
                        <span className="invline__meta">
                          {r.qty} × {r.unitPrice}
                        </span>
                      </span>
                      <span className="invline__amt">{fmt(rowAmount(r))}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          <div className="invtotal" style={{ marginTop: 10 }}>
            <span>총 결제요청 금액</span>
            <b>{fmt(total)}원</b>
          </div>
          <p className="confirm__hint">
            같은 계산서가 갱신되고, 점주에게 &lsquo;계산서가 수정되었습니다&rsquo;
            알림이 새로 가요. (기존 계산서는 그대로 유지·갱신되어 중복이 생기지 않아요.)
          </p>
          <div className="confirm__actions">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setConfirming(false)}
            >
              다시 볼게요
            </button>
            <SubmitButton pendingText="보내는 중…">네, 수정 발송</SubmitButton>
          </div>
        </div>
      )}
    </form>
  );
}
