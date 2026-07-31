"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  saveInvoiceAction,
  loadInvoiceToolItemsAction,
  loadWeeklyIntoInvoiceAction,
  saveWeeklyItemsAction,
  clearWeeklyFromInvoiceAction,
  getInvoiceSyncAction,
  type InvoiceFormState,
} from "@/app/actions/invoice";
import { SubmitButton } from "./SubmitButton";
import { CATEGORIES, type Category } from "@/lib/constants";
import { parseQtyStrict, parsePriceStrict } from "@/lib/money";
import { sumQty } from "@/lib/qty";
import { MoneyInput } from "./MoneyInput";

type Row = { id: number; name: string; qty: string; unitPrice: string };
type WeeklyRow = { id: number; name: string; qty: string; unitPrice: string; unit: string };

export type InvoiceWeeklyItem = {
  name: string;
  qty: string;
  unitPrice: string;
  unit: string;
};

export type InvoiceInitialItem = {
  category: Category;
  name: string;
  qty: string;
  unitPrice: string;
};

export type InvoiceRefGroup = {
  category: Category;
  items: { name: string; qty: string; note: string }[];
};

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.unitPrice.trim());
}

// 서버(cleanItems)와 동일한 엄격 파싱 — 형식이 아니면 금액을 아예 표시하지 않는다
function rowAmount(r: Row): number {
  const qty = parseQtyStrict(r.qty);
  const price = parsePriceStrict(r.unitPrice);
  if (qty == null || price == null) return 0;
  return Math.round(qty * price);
}

const fmt = (n: number) => n.toLocaleString("ko-KR");

export function InvoiceForm({
  invoiceId,
  userId,
  date,
  categories,
  initialItems = [],
  refGroups = [],
  confirmedCats = "",
  weeklyAvailable = false,
  weeklyItems = [],
}: {
  invoiceId?: string;
  userId: string;
  date: string;
  categories: Category[];
  initialItems?: InvoiceInitialItem[];
  refGroups?: InvoiceRefGroup[];
  confirmedCats?: string;
  weeklyAvailable?: boolean; // 이 출고일에 불러올 확정 주간발주가 있는가
  weeklyItems?: InvoiceWeeklyItem[]; // 이미 이 계산서에 불러와진 주간발주 합산분
}) {
  const uid = useRef(0);
  const newRow = (): Row => ({
    id: ++uid.current,
    name: "",
    qty: "",
    unitPrice: "",
  });

  const [rowsByCat, setRowsByCat] = useState<Record<string, Row[]>>(() => {
    const init: Record<string, Row[]> = {};
    for (const c of categories) init[c] = [];
    for (const it of initialItems) {
      if (!init[it.category]) continue;
      init[it.category].push({
        id: ++uid.current,
        name: it.name,
        qty: it.qty,
        unitPrice: it.unitPrice,
      });
    }
    for (const c of categories) init[c].push(newRow());
    return init;
  });
  const [confirming, setConfirming] = useState(false);
  const [localError, setLocalError] = useState("");
  const [loadingCat, setLoadingCat] = useState<Category | null>(null);
  const [loadNote, setLoadNote] = useState<{ cat: Category; msg: string } | null>(null);
  const [state, formAction] = useActionState<InvoiceFormState, FormData>(
    saveInvoiceAction,
    {},
  );

  // ── 주간발주 합산분 ── 불러오면(weeklyItems) 편집 가능(자동저장). 일반 4카테고리 확정 흐름과 분리.
  // 토글 ON/OFF는 서버 액션(불러오기/빼기)이 리다이렉트로 다시 그리므로, 여기선 서버 기준으로만 판정.
  const weeklyOn = weeklyItems.length > 0;
  const [weeklyRows, setWeeklyRows] = useState<WeeklyRow[]>(() => {
    const rows = weeklyItems.map((w) => ({ id: ++uid.current, ...w }));
    rows.push({ id: ++uid.current, name: "", qty: "", unitPrice: "", unit: "" });
    return rows;
  });
  const [weeklySaving, startWeeklySave] = useTransition();

  function updateWeekly(id: number, field: keyof WeeklyRow, value: string) {
    setWeeklyRows((prev) => {
      const list = prev.map((r) => (r.id === id ? { ...r, [field]: value } : r));
      const kept = list.filter((r) => isFilled(r) || r.id === id);
      const last = kept[kept.length - 1];
      if (!last || isFilled(last))
        kept.push({ id: ++uid.current, name: "", qty: "", unitPrice: "", unit: "" });
      return kept;
    });
  }
  function removeWeekly(id: number) {
    setWeeklyRows((prev) => {
      const list = prev.filter((r) => r.id !== id);
      const last = list[list.length - 1];
      if (!last || isFilled(last))
        list.push({ id: ++uid.current, name: "", qty: "", unitPrice: "", unit: "" });
      return list;
    });
  }

  // 주간발주 편집 자동저장(디바운스 900ms). 첫 렌더는 건너뜀.
  const weeklyDirty = useRef(false);
  useEffect(() => {
    if (!invoiceId || !weeklyOn) return;
    if (!weeklyDirty.current) {
      weeklyDirty.current = true;
      return;
    }
    const t = setTimeout(() => {
      const payload = weeklyRows
        .filter(isFilled)
        .map((r) => ({ name: r.name, qty: r.qty, unitPrice: r.unitPrice, unit: r.unit }));
      const fd = new FormData();
      fd.set("invoiceId", invoiceId);
      fd.set("weekly", JSON.stringify(payload));
      startWeeklySave(async () => {
        await saveWeeklyItemsAction({}, fd);
      });
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weeklyRows]);

  const weeklyTotal = weeklyRows.reduce((n, r) => n + rowAmount(r), 0);
  const weeklyFilledCount = weeklyRows.filter(isFilled).length;

  function updateRow(cat: Category, id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[cat].map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      // 채워진 줄 + '지금 편집 중인 줄'만 남기고(포커스 유지), 나머지 빈 줄은 접는다.
      // 끝에는 입력용 빈 줄 하나를 항상 유지 → 항목을 지우면 늘어난 빈 칸이 자동으로 줄어든다.
      const kept = list.filter((r) => isFilled(r) || r.id === id);
      const last = kept[kept.length - 1];
      if (!last || isFilled(last)) kept.push(newRow());
      return { ...prev, [cat]: kept };
    });
  }

  // 항목 한 줄 통째로 삭제(맨 끝 ✕) — 백스페이스로 하나씩 지울 필요 없이 즉시 제거.
  function removeRow(cat: Category, id: number) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[cat].filter((r) => r.id !== id);
      // 끝에는 입력용 빈 줄 하나를 항상 유지.
      const last = list[list.length - 1];
      if (!last || isFilled(last)) list.push(newRow());
      return { ...prev, [cat]: list };
    });
  }

  // '불러오기' — 그 출고일에 청구할 해당 카테고리 품목(담기 발주 + 공구는 예약 확정분)을 서버에서 받아
  // 그 칸에 그대로 채운다. 일일이 손으로 안 쳐도 되게. 기존 입력은 불러온 목록으로 교체. (공구·채움채)
  async function loadToolItems(cat: Category) {
    if (loadingCat) return;
    setLoadingCat(cat);
    setLoadNote(null);
    try {
      const { items } = await loadInvoiceToolItemsAction(userId, date, cat);
      setConfirming(false);
      setRowsByCat((prev) => {
        const rows: Row[] = items.map((it) => ({
          id: ++uid.current,
          name: it.name,
          qty: it.qty,
          unitPrice: it.unitPrice,
        }));
        rows.push(newRow());
        return { ...prev, [cat]: rows };
      });
      setLoadNote({
        cat,
        msg:
          items.length > 0
            ? `${items.length}개 품목을 불러왔어요. 확인 후 확정해 주세요.`
            : `불러올 ${CATEGORIES[cat].label} 발주가 없어요.`,
      });
    } catch {
      setLoadNote({ cat, msg: "불러오기에 실패했어요. 잠시 후 다시 시도해 주세요." });
    } finally {
      setLoadingCat(null);
    }
  }

  // payload: 카테고리 순서 그대로, 채워진 줄만
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
          })),
      ),
    [categories, rowsByCat],
  );

  const subtotals = useMemo(() => {
    const m: Record<string, { count: number; sum: number; qty: number }> = {};
    for (const c of categories) {
      const rows = (rowsByCat[c] ?? []).filter(isFilled);
      m[c] = {
        count: rows.length,
        sum: rows.reduce((n, r) => n + rowAmount(r), 0),
        qty: sumQty(rows.map((r) => r.qty)),
      };
    }
    return m;
  }, [categories, rowsByCat]);

  const dailyTotal = categories.reduce((n, c) => n + (subtotals[c]?.sum ?? 0), 0);
  const total = dailyTotal + weeklyTotal; // 주간발주 합산분 포함
  const totalCount =
    categories.reduce((n, c) => n + (subtotals[c]?.count ?? 0), 0) +
    weeklyFilledCount;

  // #8 자동 임시저장 — 입력을 localStorage에 저장/복원(다른 페이지 갔다와도 유지). 임시저장 버튼 불필요.
  // ⚠ 동시작성: localStorage는 '이 브라우저'만의 것이라, 다른 사람이 확정한 카테고리를 덮으면 안 된다.
  //   → 확정(잠금)된 카테고리는 서버(공유) 데이터를 유지하고, 미확정(내가 작성 중) 카테고리만 복원한다.
  const draftKey = `invdraft:${userId}:${date}`;
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return;
      const saved = JSON.parse(raw) as Record<string, Row[]>;
      if (!saved || typeof saved !== "object") return;
      setRowsByCat((prev) => {
        const next: Record<string, Row[]> = { ...prev }; // 서버에서 만든 rows에서 시작
        for (const c of categories) {
          if (confirmed.has(c)) continue; // 확정 카테고리는 서버 데이터 보존(다른 사람 입력 유지)
          const rows = (saved[c] ?? []).filter(
            (r) => r && (r.name || r.qty || r.unitPrice),
          );
          if (rows.length)
            next[c] = [...rows.map((r) => ({ ...r, id: ++uid.current })), newRow()];
        }
        return next;
      });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(draftKey, JSON.stringify(rowsByCat));
    } catch {}
  }, [rowsByCat, draftKey]);

  // #11 카테고리별 확정 상태(과일/야채/공구/채움채). 4개 모두 확정돼야 발행 가능.
  const [confirmed, setConfirmed] = useState<Set<string>>(
    () => new Set(confirmedCats.split(",").map((s) => s.trim()).filter(Boolean)),
  );
  const allConfirmed = categories.every((c) => confirmed.has(c));

  // 동시작성 실시간 반영 — 5초마다 서버(공유 초안)의 확정분을 가져와 관찰자 화면에 반영한다.
  // 확정(잠금)된 카테고리는 서버 기준으로 갱신(다른 폰/PC가 넣은 품목이 바로 보임).
  // 내가 작성 중(미확정)인 카테고리는 절대 건드리지 않는다(내 입력 보존).
  useEffect(() => {
    if (!invoiceId) return;
    let cancelled = false;
    const pull = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await getInvoiceSyncAction(invoiceId);
        if (cancelled || !res.ok || res.gone || res.status !== "DRAFT") return;
        const serverConfirmed = new Set(
          String(res.confirmedCats ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        );
        setConfirmed((prevC) => {
          if (
            prevC.size === serverConfirmed.size &&
            [...serverConfirmed].every((c) => prevC.has(c))
          )
            return prevC; // 동일 — 불필요 렌더 방지
          return new Set(serverConfirmed);
        });
        const byCat: Record<string, { name: string; qty: string; unitPrice: string }[]> = {};
        for (const it of res.items ?? []) (byCat[it.category] ??= []).push(it);
        setRowsByCat((prev) => {
          let changed = false;
          const next = { ...prev };
          for (const c of categories) {
            if (!serverConfirmed.has(c)) continue; // 미확정은 로컬 보존
            const srv = byCat[c] ?? [];
            const cur = (prev[c] ?? []).filter(isFilled);
            const same =
              cur.length === srv.length &&
              cur.every(
                (r, i) =>
                  r.name === srv[i].name &&
                  r.qty === srv[i].qty &&
                  r.unitPrice === srv[i].unitPrice,
              );
            if (same) continue;
            next[c] = [
              ...srv.map((r) => ({ id: ++uid.current, ...r })),
              newRow(),
            ];
            changed = true;
          }
          return changed ? next : prev;
        });
      } catch {
        /* noop */
      }
    };
    pull();
    const iv = setInterval(pull, 5000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoiceId]);

  // 한 카테고리의 채워진 줄들이 유효한지(빈 카테고리는 유효 — 없는 품목도 확정 가능)
  function validateCat(c: Category): boolean {
    for (const r of (rowsByCat[c] ?? []).filter(isFilled)) {
      if (!r.name.trim()) {
        setLocalError(`${CATEGORIES[c].label}: 품목명이 비어 있는 줄이 있어요.`);
        return false;
      }
      if (parseQtyStrict(r.qty) == null) {
        setLocalError(`${CATEGORIES[c].label} '${r.name}' 수량을 확인해 주세요.`);
        return false;
      }
      if (parsePriceStrict(r.unitPrice) == null) {
        setLocalError(`${CATEGORIES[c].label} '${r.name}' 단가를 확인해 주세요.`);
        return false;
      }
    }
    setLocalError("");
    return true;
  }

  // 확정/수정을 DB에 즉시 저장(현장이 달라 시간차 확정 — 오전 과채, 이후 공구/채움채).
  // '토글한 그 카테고리'만 서버에 알려, 다른 컴퓨터가 확정한 다른 카테고리를 덮어쓰지 않게 한다.
  function persistConfirmed(cat: Category, on: boolean) {
    const fd = new FormData();
    if (invoiceId) fd.set("invoiceId", invoiceId);
    fd.set("userId", userId);
    fd.set("date", date);
    fd.set("payload", JSON.stringify(payload));
    fd.set("confirmCat", cat); // 토글한 카테고리 하나
    fd.set("confirmOn", on ? "1" : "0"); // 확정=1 / 수정(해제)=0
    fd.set("allCats", categories.join(","));
    fd.set("mode", "confirm");
    startTransition(() => formAction(fd));
  }
  function toggleConfirm(c: Category) {
    const next = new Set(confirmed);
    let on: boolean;
    if (next.has(c)) {
      next.delete(c); // 수정 — 잠금 해제
      on = false;
    } else {
      if (!validateCat(c)) return; // 확정 — 유효할 때만 잠금
      next.add(c);
      on = true;
    }
    setConfirmed(next);
    persistConfirmed(c, on);
  }

  // 발행 전 검증 — 서버(cleanItems)와 동일 규칙
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
      }
    }
    if (totalCount === 0) {
      setLocalError("품목을 한 개 이상 입력하세요.");
      return false;
    }
    setLocalError("");
    return true;
  }

  return (
    <>
      <form
        action={formAction}
        onKeyDown={(e) => {
          // 입력칸에서 Enter로 폼이 제출(=발행)되는 사고 방지 — 버튼으로만 제출
          if (
            e.key === "Enter" &&
            (e.target as HTMLElement).tagName === "INPUT"
          ) {
            e.preventDefault();
          }
        }}
      >
        {invoiceId && <input type="hidden" name="invoiceId" value={invoiceId} />}
        <input type="hidden" name="userId" value={userId} />
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="payload" value={JSON.stringify(payload)} />
        <input type="hidden" name="confirmedCats" value={[...confirmed].join(",")} />
        <input type="hidden" name="allCats" value={categories.join(",")} />

        {(state?.error || localError) && (
          <div className="notice notice--error" style={{ marginBottom: 12 }}>
            {state?.error || localError}
          </div>
        )}

        {categories.map((c) => {
          const sub = subtotals[c] ?? { count: 0, sum: 0 };
          return (
            <div
              className={`invcat ${confirmed.has(c) ? "is-locked" : ""}`}
              key={c}
            >
              <div className="invcat__head">
                <span className="chip">{CATEGORIES[c].label}</span>
                {(sub.qty > 0 || sub.sum > 0) && (
                  <span className="invcat__sum">
                    {sub.qty > 0 ? `총 ${fmt(sub.qty)}개` : ""}
                    {sub.qty > 0 && sub.sum > 0 ? " · " : ""}
                    {sub.sum > 0 ? `${fmt(sub.sum)}원` : ""}
                  </span>
                )}
                {/* 오른쪽 액션 묶음 — 공구·채움채는 '불러오기'(담기·예약 발주 로드)를 확정 버튼 옆에 깔끔히 */}
                <div className="invcat__actions">
                  {(c === "TOOL" || c === "TOFU") && !confirmed.has(c) && (
                    <button
                      type="button"
                      className="invcat__load"
                      onClick={() => loadToolItems(c)}
                      disabled={loadingCat !== null}
                    >
                      {loadingCat === c ? "불러오는 중…" : "불러오기"}
                    </button>
                  )}
                  <button
                    type="button"
                    className={`btn btn--xs ${confirmed.has(c) ? "btn--soft" : "btn--primary"}`}
                    style={{ flexShrink: 0 }}
                    onClick={() => toggleConfirm(c)}
                  >
                    {confirmed.has(c) ? "수정" : "확정"}
                  </button>
                </div>
              </div>
              {loadNote?.cat === c && (
                <div className="invcat__loadnote">{loadNote.msg}</div>
              )}
              <div className="invcols">
                <span>품목</span>
                <span>수량</span>
                <span>단가</span>
                <span style={{ textAlign: "right" }}>금액</span>
              </div>
              {(rowsByCat[c] ?? []).map((r) => {
                const amt = rowAmount(r);
                const locked = confirmed.has(c);
                return (
                  <div className="invrow" key={r.id}>
                    <input
                      className="input"
                      value={r.name}
                      disabled={locked}
                      onChange={(e) => updateRow(c, r.id, "name", e.target.value)}
                      placeholder="품목"
                    />
                    <input
                      className="input"
                      inputMode="decimal"
                      value={r.qty}
                      disabled={locked}
                      onChange={(e) => updateRow(c, r.id, "qty", e.target.value)}
                      placeholder="수량"
                    />
                    <MoneyInput
                      value={r.unitPrice}
                      disabled={locked}
                      onChange={(raw) => updateRow(c, r.id, "unitPrice", raw)}
                      placeholder="단가"
                    />
                    <span className="invrow__amt">
                      {amt > 0 ? fmt(amt) : ""}
                    </span>
                    {!locked && isFilled(r) && (
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
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* 주간발주 합산분 — 채움채 아래. 불러오면 편집 가능(자동저장), 발행 시 합계에 포함. */}
        {(weeklyAvailable || weeklyOn) && (
          <div className="invcat">
            <div className="invcat__head">
              <span className="chip">주간발주</span>
              {weeklyOn && weeklyTotal > 0 && (
                <span className="invcat__sum">{fmt(weeklyTotal)}원</span>
              )}
              <div className="invcat__actions">
                {weeklySaving && (
                  <span className="hint" style={{ fontSize: 11 }}>
                    저장 중…
                  </span>
                )}
                {/* 폼 제출로 서버 액션 호출(불러오기=ON / 빼기=OFF) — 폼의 userId·date·invoiceId hidden 사용. */}
                <button
                  type="submit"
                  formAction={
                    weeklyOn ? clearWeeklyFromInvoiceAction : loadWeeklyIntoInvoiceAction
                  }
                  role="switch"
                  aria-checked={weeklyOn}
                  aria-label="주간발주 합산"
                  className={`switch ${weeklyOn ? "is-on" : ""}`}
                >
                  <span className="switch__knob" />
                </button>
              </div>
            </div>
            {!weeklyOn ? null : (
              <>
                <div className="invcols">
                  <span>품목</span>
                  <span>수량</span>
                  <span>단가</span>
                  <span style={{ textAlign: "right" }}>금액</span>
                </div>
                {weeklyRows.map((r) => {
                  const amt = rowAmount(r);
                  return (
                    <div className="invrow" key={r.id}>
                      <input
                        className="input"
                        value={r.name}
                        onChange={(e) => updateWeekly(r.id, "name", e.target.value)}
                        placeholder="품목"
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: 3, minWidth: 0 }}>
                        <input
                          className="input"
                          inputMode="decimal"
                          value={r.qty}
                          onChange={(e) => updateWeekly(r.id, "qty", e.target.value)}
                          placeholder="수량"
                          style={{ minWidth: 0 }}
                        />
                        {r.unit && (
                          <span style={{ fontSize: 11, color: "var(--muted-2)", flexShrink: 0 }}>
                            {r.unit}
                          </span>
                        )}
                      </div>
                      <MoneyInput
                        value={r.unitPrice}
                        onChange={(raw) => updateWeekly(r.id, "unitPrice", raw)}
                        placeholder="단가"
                      />
                      <span className="invrow__amt">{amt > 0 ? fmt(amt) : ""}</span>
                      {isFilled(r) && (
                        <button
                          type="button"
                          className="invrow__x"
                          onClick={() => removeWeekly(r.id)}
                          aria-label="이 항목 지우기"
                          title="이 항목 지우기"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}

        <div className="invtotal">
          <span>합계 · 자동 계산 ({totalCount}건)</span>
          <b>{fmt(total)}원</b>
        </div>

        {!confirming ? (
          <>
            <div style={{ marginTop: 16 }}>
              <button
                type="button"
                className="btn btn--primary btn--block"
                disabled={!allConfirmed}
                onClick={() => {
                  if (validate()) setConfirming(true);
                }}
              >
                발행하기
              </button>
            </div>
          </>
        ) : (
          <div className="confirm">
            <input type="hidden" name="mode" value="issue" />
            <div className="confirm__title">이대로 발행할까요?</div>
            {categories
              .filter((c) => (subtotals[c]?.count ?? 0) > 0)
              .map((c) => {
                const rows = (rowsByCat[c] ?? []).filter(isFilled);
                return (
                  <div className="invcat" key={c}>
                    <div className="invcat__head">
                      <span className="chip">{CATEGORIES[c].label}</span>
                      <span className="invcat__sum">
                        {fmt(subtotals[c].sum)}원
                      </span>
                    </div>
                    {rows.map((r) => (
                      <div className="invline" key={r.id}>
                        <span>
                          {r.name}
                          <span className="invline__meta">
                            {r.qty} × {r.unitPrice}
                          </span>
                        </span>
                        <span className="invline__amt">
                          {fmt(rowAmount(r))}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            {weeklyOn && weeklyFilledCount > 0 && (
              <div className="invcat">
                <div className="invcat__head">
                  <span className="chip">주간발주</span>
                  <span className="invcat__sum">{fmt(weeklyTotal)}원</span>
                </div>
                {weeklyRows.filter(isFilled).map((r) => (
                  <div className="invline" key={r.id}>
                    <span>
                      {r.name}
                      <span className="invline__meta">
                        {r.qty}
                        {r.unit} × {r.unitPrice}
                      </span>
                    </span>
                    <span className="invline__amt">{fmt(rowAmount(r))}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="invtotal" style={{ marginTop: 10 }}>
              <span>총 결제요청 금액</span>
              <b>{fmt(total)}원</b>
            </div>
            <p className="confirm__hint">
              발행하면 점주에게 &lsquo;입금요청서&rsquo; 알림이 가요. 발행 후
              수정은 취소 → 재작성으로만 가능해요.
            </p>
            <div className="confirm__actions">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setConfirming(false)}
              >
                다시 볼게요
              </button>
              <SubmitButton pendingText="발행 중…">네, 발행할게요</SubmitButton>
            </div>
          </div>
        )}
      </form>
    </>
  );
}
