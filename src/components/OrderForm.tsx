// ============================================================
//  OrderForm — 코발트 교체본
//  위치: src/components/OrderForm.tsx 교체
//
//  변경(표시만, 로직 100% 동일):
//  ③ 큰 제목 "발주하기" 삭제 → 오른쪽 정렬 "채팅으로 발주하기" 칩
//  ④ 카테고리 탭: 개별 버튼 → 세그먼트 컨트롤(활성 탭에 ·N 카운트)
//  ⑤ "받는 곳" 밴드 삭제 → "발주 품목 · {받는곳}" + "N건" 라벨 줄
//  ⑥ 품목 입력: 낱개 카드 → 리스트 카드(번호칩·파란 좌측보더·삭제)
//     ※ 빈 마지막 행 자동 추가(withTrailingEmpty) 로직 그대로 =
//       마지막 옅은 행이 곧 "품목 추가" 역할
//  ⑦ CTA: "발주하기" → "발주 확정 · N건" + sticky
//
//  유지: payload/hidden input, 채움채(TOFU) 체크리스트, 픽업시간,
//        locked fieldset, 확인 시트(모달), useActionState, 에러 표시
// ============================================================

"use client";

import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createOrderAction,
  updateDayOrderAction,
  previewGridOrderAction,
  type OrderFormState,
} from "@/app/actions/order";
import { holdStockAction } from "@/app/actions/stock";
import { SubmitButton } from "./SubmitButton";
import { ChatOrder } from "./ChatOrder";
import { FulfillmentPicker } from "./FulfillmentPicker";
import { InlineStockStepper } from "./InlineStockStepper";
import { StockPickerSheet, type StockPickItem } from "./StockPickerSheet";
import { useLiveStock, refreshLiveStock } from "@/lib/useLiveStock";
import { expiryInfo } from "@/lib/date";
import {
  CATEGORIES,
  FULFILLMENT_LABEL,
  receiverLabel,
  type Category,
  type Fulfillment,
  type Role,
} from "@/lib/constants";
import { CHAEUMCHAE_CATALOG } from "@/lib/chaeumchae";

type Row = { id: number; name: string; qty: string; note: string };
export type ToolHold = {
  itemId: string;
  name: string;
  qty: string;
  mine: number;
  available: number;
  supplyPrice: number;
  expiry?: string; // #9 유통기한 "YYYY-MM-DD"(빈값=없음)
  majorCat?: string;
  minorCat?: string;
};

function isFilled(r: Row) {
  return !!(r.name.trim() || r.qty.trim() || r.note.trim());
}

export function OrderForm({
  categories,
  needsPickup,
  needsFulfillment = false,
  address = "",
  locked = false,
  role,
  reservedTool = [],
  reservedLabel = "",
  toolCart = [],
  windowKey = "",
  editDate = "",
  initialRowsByCat,
  initialTofuQty,
  initialPickup = "",
  initialFulfillment = "",
  invOptions = [],
  gridDisabled = false,
  chatDisabled = false,
  fixedFruit = false,
  fixedVeg = false,
  fixedItems = { FRUIT: [], VEG: [] },
}: {
  categories: Category[];
  needsPickup: boolean;
  /** 핫딜마켓 가맹점: 발주 시 직접 픽업/배송 선택 필요 */
  needsFulfillment?: boolean;
  /** 배송 선택 시 자동 배송지로 표시할 등록 매장 주소 */
  address?: string;
  locked?: boolean;
  role: Role;
  /** 픽업 전날 자동 반영되는 예약분(읽기전용) — 공구에 표시만, 주문엔 복제 안 함 */
  reservedTool?: { name: string; qty: number }[];
  reservedLabel?: string;
  /** 재고 담기(서버 담기원장) — 공구에서 남은수량 보며 +/-. 발주 페이로드도 이 서버소스 기준 */
  toolCart?: ToolHold[];
  /** 현재 발주창 키 — 입력 초안(임시저장)의 유효 범위. 창이 바뀌면(다음날) 초안 자동 폐기. */
  windowKey?: string;
  /** 수정 모드 — 값(발주일 YYYY-MM-DD)이 있으면 '발주 수정'(updateDayOrderAction). 아니면 신규 발주. */
  editDate?: string;
  /** 수정 모드 시드 — 종류별 기존 발주 품목 */
  initialRowsByCat?: Record<string, { name: string; qty: string; note: string }[]>;
  /** 수정 모드 시드 — 채움채 수량(catalog seq → qty) */
  initialTofuQty?: Record<string, string>;
  initialPickup?: string;
  initialFulfillment?: "" | Fulfillment;
  /** 공구 '재고에서 검색·담기' 팝업용 재고현황 품목(남은 재고 포함). 없으면 팝업 숨김. */
  invOptions?: StockPickItem[];
  /** 일반 발주 관리 — 칸/채팅 발주 잠금(서버에서 유효값 계산해 전달). */
  gridDisabled?: boolean;
  chatDisabled?: boolean;
  /** 과일/야채 품목 고정 여부. */
  fixedFruit?: boolean;
  fixedVeg?: boolean;
  /** 고정 품목 목록(카테고리별). 고정 ON인 카테고리만 사용. */
  fixedItems?: {
    FRUIT: { id: string; name: string }[];
    VEG: { id: string; name: string }[];
  };
}) {
  // 수정 모드 = editDate 존재. 저장은 updateDayOrderAction, 초안(localStorage)·채팅 진입 비활성.
  const editMode = !!editDate;
  // 일반 발주 관리 — 과일/야채 '품목 고정' 여부와 고정 품목 목록.
  const isFixedCat = (c: Category) =>
    (c === "FRUIT" && fixedFruit) || (c === "VEG" && fixedVeg);
  const fixedItemsFor = (c: Category): { id: string; name: string }[] =>
    c === "FRUIT" ? fixedItems.FRUIT ?? [] : c === "VEG" ? fixedItems.VEG ?? [] : [];
  const router = useRouter();
  const [toolPickerOpen, setToolPickerOpen] = useState(false);
  const uid = useRef(0);
  const newRow = (): Row => ({ id: ++uid.current, name: "", qty: "", note: "" });

  // 칸 발주가 잠겨 있으면 채팅으로 시작(수정 모드는 항상 칸). 서버가 둘 다 잠기지 않도록 보장.
  const [mode, setMode] = useState<"grid" | "chat">(
    editMode ? "grid" : gridDisabled ? "chat" : "grid",
  );
  const [active, setActive] = useState<Category>(categories[0]);
  const [rowsByCat, setRowsByCat] = useState<Record<string, Row[]>>(() => {
    const init: Record<string, Row[]> = {};
    for (const c of categories) {
      // 공구(TOOL)는 서버 담기원장(toolCart)이 단일 소스 — rowsByCat 에 담지 않는다(빈 줄 유지).
      const seed = c !== "TOOL" ? initialRowsByCat?.[c] : undefined;
      init[c] =
        seed && seed.length
          ? [
              ...seed.map((r) => ({
                id: ++uid.current,
                name: r.name,
                qty: r.qty,
                note: r.note,
              })),
              newRow(),
            ]
          : [newRow()];
    }
    return init;
  });
  const [pickup, setPickup] = useState(initialPickup);
  const [fulfillment, setFulfillment] = useState<"" | Fulfillment>(
    initialFulfillment,
  );
  const [tofuQty, setTofuQty] = useState<Record<string, string>>(
    () => initialTofuQty ?? {},
  );
  // 고정 품목 입력값(id → {수량, 설명}). 수정 모드면 기존 발주 품목에서 이름으로 매칭해 시드.
  const [fixedVals, setFixedVals] = useState<
    Record<string, { qty: string; note: string }>
  >(() => {
    const out: Record<string, { qty: string; note: string }> = {};
    const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
    for (const cat of ["FRUIT", "VEG"] as const) {
      if (!isFixedCat(cat)) continue;
      const seed = initialRowsByCat?.[cat] ?? [];
      for (const it of fixedItemsFor(cat)) {
        const match = seed.find((r) => norm(r.name) === norm(it.name));
        if (match) out[it.id] = { qty: match.qty ?? "", note: match.note ?? "" };
      }
    }
    return out;
  });
  const [confirming, setConfirming] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [confirmTab, setConfirmTab] = useState<Category>(categories[0]);
  const [localError, setLocalError] = useState("");
  const live = useLiveStock(); // 공구 담은 재고 남은수량 실시간

  // 공구 '재고에서 검색·담기' 팝업 — 이미 담은 품목은 스테퍼로 조절하므로 아직 안 담은 재고만 노출.
  const addableInv = useMemo(
    () => invOptions.filter((o) => !toolCart.some((t) => t.itemId === o.id)),
    [invOptions, toolCart],
  );
  async function addHoldFromPicker(item: StockPickItem) {
    const res = await holdStockAction({ itemId: item.id, qty: 1 });
    if (!res.ok) {
      setLocalError(res.error ?? "담기에 실패했어요.");
      return;
    }
    setLocalError("");
    refreshLiveStock();
    router.refresh(); // toolCart 재조회 → 담은 품목이 스테퍼로 나타남
  }
  const [state, formAction] = useActionState<OrderFormState, FormData>(
    editMode ? updateDayOrderAction : createOrderAction,
    {},
  );

  const rows = rowsByCat[active] ?? [];

  // ── #4 발주 입력 초안 보존 ──────────────────────────────────
  // 다른 페이지 이동/백그라운드에도 입력이 안 지워지게 localStorage에 임시저장.
  // '같은 발주창(windowKey)'일 때만 복원 → 마감 지나 창이 바뀌면(다음날) 자동 폐기.
  // 주의: 발주 데이터(DB)와 무관한 브라우저 로컬 임시본일 뿐.
  const DRAFT_KEY = "orderDraft_v1";
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current || !windowKey) return;
    restored.current = true;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d || d.windowKey !== windowKey) {
        localStorage.removeItem(DRAFT_KEY); // 다른(지난) 발주창 초안 → 폐기
        return;
      }
      if (d.rowsByCat && typeof d.rowsByCat === "object") {
        const remapped: Record<string, Row[]> = {};
        for (const c of categories) {
          const list = Array.isArray(d.rowsByCat[c]) ? d.rowsByCat[c] : null;
          remapped[c] =
            list && list.length
              ? normalizeRows(
                  list.map((r: { name?: string; qty?: string; note?: string }) => ({
                    id: ++uid.current,
                    name: String(r?.name ?? ""),
                    qty: String(r?.qty ?? ""),
                    note: String(r?.note ?? ""),
                  })),
                )
              : [newRow()];
        }
        setRowsByCat(remapped);
      }
      if (typeof d.pickup === "string") setPickup(d.pickup);
      if (typeof d.fulfillment === "string") setFulfillment(d.fulfillment as Fulfillment);
      if (d.tofuQty && typeof d.tofuQty === "object") setTofuQty(d.tofuQty);
    } catch {
      /* noop */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!restored.current || !windowKey) return;
    try {
      const hasAny =
        Object.values(rowsByCat).some((list) => list.some(isFilled)) ||
        Object.values(tofuQty).some((v) => v && v.trim()) ||
        !!pickup ||
        !!fulfillment;
      if (hasAny) {
        localStorage.setItem(
          DRAFT_KEY,
          JSON.stringify({ windowKey, rowsByCat, pickup, fulfillment, tofuQty }),
        );
      } else {
        // 전부 비우면 초안도 삭제 — 안 그러면 지운 값(예: 채움채 수량)이 옛 초안으로 되살아난다.
        localStorage.removeItem(DRAFT_KEY);
      }
    } catch {
      /* noop */
    }
  }, [rowsByCat, pickup, fulfillment, tofuQty, windowKey]);

  // 채워진 줄 + '지금 편집 중인 줄'만 남기고(포커스 유지) 나머지 빈 줄은 접는다.
  // 끝에는 입력용 빈 줄 하나를 항상 유지 → 항목을 지우면 늘어난 빈 칸이 자동으로 줄어든다(최소 1줄).
  function normalizeRows(list: Row[], editingId?: number): Row[] {
    const kept = list.filter((r) => isFilled(r) || r.id === editingId);
    const last = kept[kept.length - 1];
    if (!last || isFilled(last)) kept.push(newRow());
    return kept;
  }

  function updateRow(id: number, field: keyof Row, value: string) {
    setConfirming(false);
    setRowsByCat((prev) => {
      const list = prev[active].map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      return { ...prev, [active]: normalizeRows(list, id) };
    });
  }

  function updateRowInCat(cat: Category, id: number, field: keyof Row, value: string) {
    setRowsByCat((prev) => {
      const list = (prev[cat] ?? []).map((r) =>
        r.id === id ? { ...r, [field]: value } : r,
      );
      return { ...prev, [cat]: normalizeRows(list, id) };
    });
  }

  function removeRow(id: number) {
    setRowsByCat((prev) => {
      const list = prev[active].filter((r) => r.id !== id);
      return { ...prev, [active]: normalizeRows(list) };
    });
  }

  const payload = useMemo(
    () =>
      categories
        .map((c) => {
          if (c === "TOFU") {
            const items = CHAEUMCHAE_CATALOG.filter(
              (p) => (tofuQty[p.seq] ?? "").trim(),
            ).map((p) => ({ name: p.name, qty: tofuQty[p.seq].trim(), note: "" }));
            return { category: c, items };
          }
          if (c === "TOOL") {
            // 공구는 서버 담기원장(toolCart)이 소스 — +/- 후 refresh 되면 여기도 최신
            const items = toolCart
              .filter((t) => t.name.trim() && Number(t.qty) > 0)
              .map((t) => ({ name: t.name, qty: t.qty, note: "" }));
            return { category: c, items };
          }
          if (isFixedCat(c)) {
            // 품목 고정 — 지정 품목명 그대로(수정 불가), 수량 입력분만 발주에 포함.
            const items = fixedItemsFor(c)
              .filter((it) => (fixedVals[it.id]?.qty ?? "").trim())
              .map((it) => ({
                name: it.name,
                qty: (fixedVals[it.id]?.qty ?? "").trim(),
                note: (fixedVals[it.id]?.note ?? "").trim(),
              }));
            return { category: c, items };
          }
          const items = (rowsByCat[c] ?? [])
            .filter(isFilled)
            .map((r) => ({ name: r.name, qty: r.qty, note: r.note }));
          return { category: c, items };
        })
        .filter((g) => g.items.length > 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categories, rowsByCat, tofuQty, toolCart, fixedVals, fixedFruit, fixedVeg],
  );

  const totalItems = payload.reduce((n, g) => n + g.items.length, 0);
  const countByCat = useMemo(() => {
    const m: Record<string, number> = {};
    for (const g of payload) m[g.category] = g.items.length;
    return m;
  }, [payload]);
  // 화면 표시용 건수 — 공구는 담은재고 + 예약분(읽기전용)까지 합쳐서 과일·야채처럼 건수 표시.
  const displayCountByCat = useMemo(() => {
    const m = { ...countByCat };
    if (reservedTool.length > 0) m.TOOL = (m.TOOL ?? 0) + reservedTool.length;
    return m;
  }, [countByCat, reservedTool.length]);

  const multi = categories.length > 1;

  // 확인 시트 탭 — 품목이 있는 종류만, 활성 탭이 비면 첫 종류로 자동 이동
  const sheetCats = categories.filter((c) => (countByCat[c] ?? 0) > 0);
  const activeConfirm = sheetCats.includes(confirmTab)
    ? confirmTab
    : sheetCats[0] ?? categories[0];

  // '발주 확정' → AI가 먼저 정리(오타→고유명사 등)한 결과를 확인 시트에 보여준다(채팅 발주와 동일).
  // 정리된 값으로 칸을 갱신 → 시트에서 확인·수정 후 최종 발주(preNormalized=1로 그대로 저장).
  async function handleConfirmClick() {
    if (totalItems === 0) {
      setLocalError("발주할 품목을 한 개 이상 입력하세요.");
      return;
    }
    if (needsFulfillment && !fulfillment) {
      setLocalError("직접 픽업 또는 배송을 선택해 주세요.");
      return;
    }
    setLocalError("");
    // 품목 고정 카테고리는 AI 정리 대상에서 제외(관리자 지정 품목명 그대로 보존).
    const previewPayload = payload.filter(
      (g) => !isFixedCat(g.category as Category),
    );
    if (previewPayload.length === 0) {
      // 고정 품목만 있는 발주 — AI 정리 없이 바로 확인 시트.
      setConfirming(true);
      return;
    }
    setPreviewing(true);
    try {
      const res = await previewGridOrderAction(JSON.stringify(previewPayload));
      if (!res.ok) {
        setLocalError(res.error ?? "정리에 실패했어요. 다시 시도해 주세요.");
        return;
      }
      // AI 정리 결과로 비-TOFU 칸을 갱신(TOFU는 tofuQty 그대로) → 시트가 '정리된 값'을 보여줌.
      // Q1: 이번에 제출한 비-TOFU 카테고리는 preview 결과로 '완전히 교체'한다. 베니지민 고구마처럼
      // 다른 카테고리(과일)로 옮겨가 비워진 칸은 빈칸으로 리셋 → 원래 칸에 잔존·중복되는 문제 해결.
      setRowsByCat((prev) => {
        const next = { ...prev };
        const toRow = (it: { name: string; qty: string; note: string }) => ({
          id: ++uid.current,
          name: it.name,
          qty: it.qty,
          note: it.note,
        });
        const byCat = new Map(
          (res.groups ?? []).map((g) => [g.category as Category, g.items]),
        );
        // 제출한 카테고리는 응답값으로 교체(응답에 없으면 = 옮겨감 → 빈칸)
        // 고정 카테고리는 rowsByCat 소스가 아니므로(fixedVals) 교체 대상에서 제외.
        for (const g of payload) {
          if (g.category === "TOFU" || isFixedCat(g.category as Category)) continue;
          next[g.category] = normalizeRows((byCat.get(g.category) ?? []).map(toRow));
        }
        // 응답에만 있는 카테고리(remap 목적지, 예: 과일)도 반영
        for (const g of res.groups ?? []) {
          if (!payload.some((p) => p.category === g.category)) {
            next[g.category] = normalizeRows(g.items.map(toRow));
          }
        }
        return next;
      });
      setConfirming(true);
    } catch {
      setLocalError("정리 중 문제가 생겼어요. 다시 시도해 주세요.");
    } finally {
      setPreviewing(false);
    }
  }

  if (mode === "chat") {
    return (
      <div>
        {!gridDisabled && (
          <button
            type="button"
            className="entrycard"
            onClick={() => setMode("grid")}
          >
            <span className="entrycard__ic">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="4" width="16" height="16" rx="2" />
                <path d="M4 10h16M10 4v16" />
              </svg>
            </span>
            <span className="entrycard__main">
              <span className="entrycard__title">칸에 직접 입력하기</span>
            </span>
            <span className="entrycard__chev">›</span>
          </button>
        )}
        <ChatOrder
          categories={categories}
          needsPickup={needsPickup}
          needsFulfillment={needsFulfillment}
          fulfillment={fulfillment}
          onFulfillmentChange={setFulfillment}
          address={address}
          locked={locked}
          reservedTool={reservedTool}
          reservedLabel={reservedLabel}
          toolCart={toolCart}
        />
      </div>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />
      {/* 확인 시트의 값은 이미 AI가 정리한(그리고 점주가 확인·수정한) 결과 →
          저장 시 재정규화하지 않고 그대로 저장(승인=저장 보장). */}
      <input type="hidden" name="preNormalized" value="1" />
      {/* 칸/채팅 구분 — 저장 액션이 방식별 잠금을 서버에서 최종 검증(UI 우회 방지) */}
      <input type="hidden" name="source" value="grid" />
      {needsPickup && <input type="hidden" name="pickupTime" value={pickup} />}
      {editMode && <input type="hidden" name="date" value={editDate} />}

      {/* 채팅 발주 진입 카드 — 수정 모드/채팅 잠금 시 숨김 */}
      {!editMode && !chatDisabled && (
        <button
          type="button"
          className="entrycard"
          onClick={() => setMode("chat")}
        >
          <span className="entrycard__ic">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 5h16v11H8l-4 4V5Z" />
            </svg>
          </span>
          <span className="entrycard__main">
            <span className="entrycard__title">채팅으로 발주하기</span>
          </span>
          <span className="entrycard__chev">›</span>
        </button>
      )}

      {locked && (
        <div className="notice notice--mute" style={{ marginBottom: 14 }}>
          지금은 발주 가능 시간이 아니에요. 발주 시작 시간에 다시 입력해 주세요.
        </div>
      )}

      {(state?.error || localError) && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state?.error || localError}
        </div>
      )}

      <fieldset
        disabled={locked}
        style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
      >
        {/* 수령 방식(직접 픽업/배송) — 핫딜마켓 가맹점, 발주 전 필수 선택 */}
        {needsFulfillment && (
          <FulfillmentPicker
            value={fulfillment}
            onChange={setFulfillment}
            address={address}
          />
        )}

        {/* ④ 세그먼트 탭 (발주 폼 전용 스코프) */}
        {multi && (
          <div className="cattabs cattabs--seg">
            {categories.map((c) => {
              const n = displayCountByCat[c] ?? 0;
              return (
                <button
                  type="button"
                  key={c}
                  className={`cattab ${active === c ? "is-active" : ""}`}
                  onClick={() => setActive(c)}
                >
                  {CATEGORIES[c].label}
                  {n > 0 && <span className="cattab__count">{n}</span>}
                </button>
              );
            })}
          </div>
        )}

        {needsPickup && (
          <div className="field">
            <label className="label" htmlFor="pickup">
              픽업 시간
            </label>
            <input
              id="pickup"
              className="input"
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
              placeholder="오전 7시 30분"
            />
          </div>
        )}

        {/* ⑤ 받는 곳 밴드 → 라벨 줄 통합 */}
        <div className="itemshead">
          <span className="itemshead__label">
            {multi ? "발주 품목" : receiverLabel(active, role)}
          </span>
          {(displayCountByCat[active] ?? 0) > 0 && (
            <span className="itemshead__count">{displayCountByCat[active]}건</span>
          )}
        </div>

        {isFixedCat(active) ? (
          /* 품목 고정 — 지정 품목만(품목명 고정), 수량·설명만 입력 */
          <div className="oitems">
            {fixedItemsFor(active).length === 0 ? (
              <div className="empty">
                등록된 고정 품목이 없어요. 관리자에게 문의해 주세요.
              </div>
            ) : (
              fixedItemsFor(active).map((it, i) => {
                const v = fixedVals[it.id] ?? { qty: "", note: "" };
                const filled = !!(v.qty.trim() || v.note.trim());
                return (
                  <div className={`oitem ${filled ? "is-filled" : ""}`} key={it.id}>
                    <span className="oitem__num">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="oitem__fields">
                      <div className="oitem__row1">
                        <div className="input input--lock">
                          <span className="input--lock__name">{it.name}</span>
                          <span className="input--lock__tag">고정</span>
                        </div>
                        <input
                          className="input"
                          inputMode="numeric"
                          value={v.qty}
                          onChange={(e) => {
                            setConfirming(false);
                            setFixedVals((prev) => ({
                              ...prev,
                              [it.id]: { qty: e.target.value, note: prev[it.id]?.note ?? "" },
                            }));
                          }}
                          placeholder="수량"
                        />
                      </div>
                      <input
                        className="input"
                        value={v.note}
                        onChange={(e) => {
                          setConfirming(false);
                          setFixedVals((prev) => ({
                            ...prev,
                            [it.id]: { qty: prev[it.id]?.qty ?? "", note: e.target.value },
                          }));
                        }}
                        placeholder="설명"
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : active === "TOFU" ? (
          <div className="tofulist">
            {CHAEUMCHAE_CATALOG.map((p) => {
              const q = tofuQty[p.seq] ?? "";
              return (
                <div
                  className={`tofuitem ${q.trim() ? "is-on" : ""}`}
                  key={p.seq}
                >
                  <span className="tofuitem__name">{p.name}</span>
                  <input
                    className="input tofuitem__qty"
                    inputMode="numeric"
                    value={q}
                    onChange={(e) => {
                      setConfirming(false);
                      setTofuQty((prev) => ({ ...prev, [p.seq]: e.target.value }));
                    }}
                    placeholder="수량"
                  />
                </div>
              );
            })}
          </div>
        ) : active === "TOOL" ? (
          /* 공구 = 자유입력 불가. 담기(읽기전용) + 픽업 전날 예약분(읽기전용)만. */
          <div className="toolro">
            {reservedTool.length > 0 && (
              <div className="toolro__group">
                <div className="toolro__head">
                  <span className="chip chip--reserve">예약분</span>
                  <span className="toolro__hint">
                    {reservedLabel ? `${reservedLabel} · ` : ""}수정 불가
                  </span>
                </div>
                {reservedTool.map((it, i) => (
                  <div className="toolro__item" key={`rv${i}`}>
                    <span className="toolro__name">{it.name}</span>
                    <span className="toolro__qty">{it.qty}개</span>
                  </div>
                ))}
              </div>
            )}
            {toolCart.length > 0 && (
              <div className="toolro__group">
                <div className="toolro__head">
                  <span className="chip">담은 재고</span>
                </div>
                {toolCart.map((t) => {
                  const avail = live.availableOf(t.itemId, t.available);
                  const mineQ = live.mineOf(t.itemId, t.mine);
                  const exp = expiryInfo(t.expiry ?? "");
                  return (
                    <div className="stockline" key={t.itemId}>
                      <div className="stockline__info">
                        <span className="stockline__name">
                          {t.name}
                          {t.majorCat && (
                            <span className="stockcat">
                              {t.majorCat}
                              {t.minorCat ? ` · ${t.minorCat}` : ""}
                            </span>
                          )}
                        </span>
                        <span className="stockmeta">
                          <span className="stockmeta__qty">남은 수량 {avail}개</span>
                          {exp && (
                            <span
                              className={`stockmeta__exp${exp.level !== "ok" ? " is-warn" : ""}`}
                            >
                              유통기한 {exp.full} · {exp.dday}
                            </span>
                          )}
                        </span>
                      </div>
                      <InlineStockStepper
                        itemId={t.itemId}
                        available={avail}
                        mine={mineQ}
                        disabled={locked}
                      />
                    </div>
                  );
                })}
              </div>
            )}
            {reservedTool.length === 0 && toolCart.length === 0 && (
              <div className="empty">
                {invOptions.length > 0 ? (
                  <>담은 공구가 없어요. 아래 ‘재고에서 검색·담기’로 담아주세요.</>
                ) : (
                  <>
                    공구는 직접 적을 수 없어요.
                    <br />
                    재고 현황에서 ‘담기’로 담아주세요. 예약분은 픽업 전날 자동으로
                    표시됩니다.
                  </>
                )}
              </div>
            )}
            {invOptions.length > 0 && (
              <>
                <button
                  type="button"
                  className="btn btn--soft btn--block"
                  style={{ marginTop: 8 }}
                  onClick={() => setToolPickerOpen(true)}
                >
                  + 재고에서 검색·담기
                </button>
                {toolPickerOpen && (
                  <StockPickerSheet
                    items={addableInv}
                    onPick={addHoldFromPicker}
                    onClose={() => setToolPickerOpen(false)}
                  />
                )}
              </>
            )}
          </div>
        ) : (
          /* ⑥ 리스트 카드 */
          <div className="oitems">
            {rows.map((r, i) => {
              const filled = isFilled(r);
              return (
                <div
                  className={`oitem ${filled ? "is-filled" : ""}`}
                  key={r.id}
                >
                  <span className="oitem__num">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <div className="oitem__fields">
                    <div className="oitem__row1">
                      <input
                        className="input"
                        value={r.name}
                        onChange={(e) => updateRow(r.id, "name", e.target.value)}
                        placeholder="품목"
                      />
                      <input
                        className="input"
                        value={r.qty}
                        onChange={(e) => updateRow(r.id, "qty", e.target.value)}
                        placeholder="수량"
                      />
                    </div>
                    <input
                      className="input"
                      value={r.note}
                      onChange={(e) => updateRow(r.id, "note", e.target.value)}
                      placeholder="설명"
                    />
                  </div>
                  {filled && (
                    <button
                      type="button"
                      className="oitem__del"
                      onClick={() => removeRow(r.id)}
                    >
                      삭제
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ⑦ CTA */}
        <div className="ctabar">
          <button
            type="button"
            className="btn btn--primary btn--block"
            disabled={locked || previewing}
            onClick={handleConfirmClick}
          >
            {previewing
              ? "AI가 정리 중…"
              : `${editMode ? "수정 확정" : "발주 확정"}${totalItems > 0 ? ` · ${totalItems}건` : ""}`}
          </button>
        </div>

        {/* 확인 시트 — 기존 그대로 */}
        {confirming && (
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            onClick={(e) => {
              if (e.target === e.currentTarget) setConfirming(false);
            }}
          >
            <div className="sheet__panel">
              <div className="sheet__head">
                <div className="sheet__title">
                  {editMode ? "이대로 수정할까요?" : "이대로 발주할까요?"}
                </div>
                <button
                  type="button"
                  className="sheet__close"
                  aria-label="닫기"
                  onClick={() => setConfirming(false)}
                >
                  ✕
                </button>
              </div>
              <p className="sheet__hint">
                AI가 이렇게 정리했어요. 맞는지 확인하고 고칠 부분은 바로 수정해 주세요.
              </p>

              {needsFulfillment && fulfillment && (
                <div className="sheet__fulfill">
                  <span className="sheet__fulfillk">
                    {FULFILLMENT_LABEL[fulfillment]}
                  </span>
                  {fulfillment === "DELIVERY" && address && (
                    <span className="sheet__fulfillv">{address}</span>
                  )}
                </div>
              )}

              {(state?.error || localError) && (
                <div className="notice notice--error" style={{ marginBottom: 10 }}>
                  {state?.error || localError}
                </div>
              )}

              {/* 종류 탭 — 발주가 많아도 종류별로 나눠 확인/수정(스크롤 짧게) */}
              {sheetCats.length > 1 && (
                <div className="cattabs cattabs--seg" style={{ marginBottom: 4 }}>
                  {sheetCats.map((c) => (
                    <button
                      type="button"
                      key={c}
                      className={`cattab ${activeConfirm === c ? "is-active" : ""}`}
                      onClick={() => setConfirmTab(c)}
                    >
                      {CATEGORIES[c].label}
                      <span className="cattab__count">{countByCat[c] ?? 0}</span>
                    </button>
                  ))}
                </div>
              )}

              <div className="sheet__body">
                {(() => {
                  const c = activeConfirm;
                  if (isFixedCat(c)) {
                    // 품목 고정 — 품목명 읽기전용, 수량·설명만 수정 가능
                    const list = fixedItemsFor(c).filter(
                      (it) => (fixedVals[it.id]?.qty ?? "").trim(),
                    );
                    if (list.length === 0) return null;
                    return (
                      <div className="confsec">
                        <div className="confsec__head">
                          <span className="chip">{CATEGORIES[c].label}</span>
                          <span className="confsec__dest">
                            {receiverLabel(c, role)} · {list.length}건
                          </span>
                        </div>
                        {list.map((it) => (
                          <div className="confitem confitem--edit" key={it.id}>
                            <div className="input confitem__name confitem__name--lock">
                              {it.name}
                            </div>
                            <input
                              className="input confitem__qty"
                              value={fixedVals[it.id]?.qty ?? ""}
                              onChange={(e) =>
                                setFixedVals((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    qty: e.target.value,
                                    note: prev[it.id]?.note ?? "",
                                  },
                                }))
                              }
                              placeholder="수량"
                            />
                            <input
                              className="input confitem__note"
                              value={fixedVals[it.id]?.note ?? ""}
                              onChange={(e) =>
                                setFixedVals((prev) => ({
                                  ...prev,
                                  [it.id]: {
                                    qty: prev[it.id]?.qty ?? "",
                                    note: e.target.value,
                                  },
                                }))
                              }
                              placeholder="설명"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (c === "TOFU") {
                    const items = CHAEUMCHAE_CATALOG.filter(
                      (p) => (tofuQty[p.seq] ?? "").trim(),
                    );
                    if (items.length === 0) return null;
                    return (
                      <div className="confsec">
                        <div className="confsec__head">
                          <span className="chip">{CATEGORIES[c].label}</span>
                          <span className="confsec__dest">
                            {receiverLabel(c, role)} · {items.length}건
                          </span>
                        </div>
                        {items.map((p) => (
                          <div className="confitem" key={p.seq}>
                            <span className="confitem__name">{p.name}</span>
                            <input
                              className="input confitem__qty"
                              inputMode="numeric"
                              value={tofuQty[p.seq] ?? ""}
                              onChange={(e) => {
                                setTofuQty((prev) => ({
                                  ...prev,
                                  [p.seq]: e.target.value,
                                }));
                              }}
                              placeholder="수량"
                            />
                          </div>
                        ))}
                      </div>
                    );
                  }
                  if (c === "TOOL") {
                    // 공구는 담기(읽기전용)만 제출 — 확인 시트에서도 수정 불가
                    const toolRows = (rowsByCat[c] ?? []).filter(isFilled);
                    if (toolRows.length === 0) return null;
                    return (
                      <div className="confsec">
                        <div className="confsec__head">
                          <span className="chip">{CATEGORIES[c].label}</span>
                          <span className="confsec__dest">
                            {receiverLabel(c, role)} · {toolRows.length}건
                          </span>
                        </div>
                        {toolRows.map((r) => (
                          <div className="confitem" key={r.id}>
                            <span className="confitem__name">{r.name}</span>
                            <span className="confitem__qtyro">{r.qty}개</span>
                          </div>
                        ))}
                      </div>
                    );
                  }
                  const rows = (rowsByCat[c] ?? []).filter(isFilled);
                  if (rows.length === 0) return null;
                  return (
                    <div className="confsec">
                      <div className="confsec__head">
                        <span className="chip">{CATEGORIES[c].label}</span>
                        <span className="confsec__dest">
                          {receiverLabel(c, role)} · {rows.length}건
                        </span>
                      </div>
                      {rows.map((r) => (
                        <div className="confitem confitem--edit" key={r.id}>
                          <input
                            className="input confitem__name"
                            value={r.name}
                            onChange={(e) =>
                              updateRowInCat(c, r.id, "name", e.target.value)
                            }
                            placeholder="품목"
                          />
                          <input
                            className="input confitem__qty"
                            value={r.qty}
                            onChange={(e) =>
                              updateRowInCat(c, r.id, "qty", e.target.value)
                            }
                            placeholder="수량"
                          />
                          <input
                            className="input confitem__note"
                            value={r.note}
                            onChange={(e) =>
                              updateRowInCat(c, r.id, "note", e.target.value)
                            }
                            placeholder="설명"
                          />
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              <div className="sheet__foot">
                <div className="sheet__count">총 {totalItems}건</div>
                <SubmitButton pendingText={editMode ? "수정 중…" : "발주 넣는 중…"}>
                  {editMode ? "네, 수정할게요" : "네, 발주할게요"}
                </SubmitButton>
              </div>
            </div>
          </div>
        )}
      </fieldset>
    </form>
  );
}
