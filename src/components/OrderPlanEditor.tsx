"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { ConfirmSheet } from "./ConfirmSheet";
import { MoneyInput } from "./MoneyInput";
import { copyPlanAction, loadPrevPlanAction, saveDayPlanAction } from "@/app/actions/order-plan";
import {
  ALL_CATS,
  CAT_LABEL,
  ITEM_CATS,
  type AnyCat,
  type InvPick,
  type ItemCat,
  type ItemDraft,
  type ItemStat,
  type SaveDayPlanInput,
} from "@/app/(admin)/admin/order-plan/_lib/types";

export type EditorPlan = {
  FRUIT: { exists: boolean; updatedAt: string | null; items: (ItemDraft & { id: string })[] };
  VEG: { exists: boolean; updatedAt: string | null; items: (ItemDraft & { id: string })[] };
  TOOL: { exists: boolean; updatedAt: string | null; items: (ItemDraft & { id: string })[] };
  TOFU: { exists: boolean; updatedAt: string | null; hiddenSeqs: string[] };
};

type Row = {
  key: string;
  id: string; // ""=새 줄
  name: string;
  description: string;
  stock: string;
  max: string;
  min: string;
  inventoryItemId: string;
  price: string;
  tax: string;
  hidden: boolean;
  brokenLink?: boolean;
};

type Msg = { kind: "ok" | "warn" | "error"; lines: string[] } | null;

let keySeq = 0;
const newKey = () => `r${++keySeq}`;
const numStr = (n: number | null) => (n === null || n === undefined ? "" : String(n));
const strNum = (s: string): number | null => {
  const t = s.replace(/[^\d]/g, "");
  return t === "" ? null : Number(t);
};
const normName = (s: string) => (s || "").replace(/\s+/g, " ").trim();

function toRow(i: ItemDraft & { brokenLink?: boolean }): Row {
  return {
    key: newKey(),
    id: i.id ?? "",
    name: i.name,
    description: i.description,
    stock: numStr(i.stockQty),
    max: numStr(i.maxPerStore),
    min: numStr(i.minPerStore),
    inventoryItemId: i.inventoryItemId,
    price: i.supplyPrice ? String(i.supplyPrice) : "",
    tax: i.tax,
    hidden: i.hidden,
    brokenLink: i.brokenLink,
  };
}
function toDraft(cat: ItemCat, r: Row): ItemDraft {
  return {
    ...(r.id ? { id: r.id } : {}),
    name: normName(r.name),
    description: r.description.trim(),
    stockQty: strNum(r.stock),
    maxPerStore: strNum(r.max),
    minPerStore: cat === "TOOL" ? strNum(r.min) : null,
    inventoryItemId: cat === "TOOL" ? r.inventoryItemId : "",
    supplyPrice: cat === "TOOL" ? (strNum(r.price) ?? 0) : 0,
    tax: cat === "TOOL" ? r.tax : "",
    hidden: r.hidden,
  };
}
const blankRow = (): Row => ({
  key: newKey(),
  id: "",
  name: "",
  description: "",
  stock: "",
  max: "",
  min: "",
  inventoryItemId: "",
  price: "",
  tax: "",
  hidden: false,
});

function initRows(plan: EditorPlan): Record<ItemCat, Row[]> {
  return {
    FRUIT: plan.FRUIT.items.map(toRow),
    VEG: plan.VEG.items.map(toRow),
    TOOL: plan.TOOL.items.map(toRow),
  };
}

/** 원본과 비교한 변경 수(추가·삭제·수정). 순서만 바뀐 것도 1건. */
function diffCount(cat: ItemCat, orig: (ItemDraft & { id: string })[], rows: Row[]): number {
  const byId = new Map(orig.map((o, i) => [o.id, { o, i }]));
  const keep = new Set(rows.map((r) => r.id).filter(Boolean));
  let n = orig.filter((o) => !keep.has(o.id)).length;
  rows.forEach((r, i) => {
    if (!r.id) {
      n++;
      return;
    }
    const hit = byId.get(r.id);
    if (!hit) {
      n++;
      return;
    }
    const d = toDraft(cat, r);
    const o = hit.o;
    const same =
      d.name === o.name &&
      d.description === o.description &&
      d.stockQty === o.stockQty &&
      d.maxPerStore === o.maxPerStore &&
      (cat !== "TOOL" || d.minPerStore === o.minPerStore) &&
      d.inventoryItemId === o.inventoryItemId &&
      (cat !== "TOOL" || o.inventoryItemId !== "" || (d.supplyPrice === o.supplyPrice && d.tax === o.tax)) &&
      d.hidden === o.hidden &&
      hit.i === i;
    if (!same) n++;
  });
  return n;
}

export function OrderPlanEditor(props: {
  date: string;
  label: string;
  shipLabel: string;
  isToday: boolean;
  readOnly: boolean;
  showStats: boolean;
  prevKey: string;
  nextKey: string;
  monthHref: string;
  plan: EditorPlan;
  stats: Record<string, ItemStat>;
  prevSources: Record<AnyCat, { date: string; label: string; count: number } | null>;
  inv: InvPick[];
  tofuCatalog: { seq: string; name: string }[];
  tofuBoxes: Record<string, number>;
  copyTargets: { key: string; label: string; planned: Record<AnyCat, boolean> }[];
  initialTab: AnyCat;
  stamp: string;
}) {
  const { date, readOnly, plan, stats, inv, showStats } = props;
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tab, setTab] = useState<AnyCat>(props.initialTab);
  const [rows, setRows] = useState<Record<ItemCat, Row[]>>(() => initRows(plan));
  const [touched, setTouched] = useState<Record<AnyCat, boolean>>({ FRUIT: false, VEG: false, TOOL: false, TOFU: false });
  const [tofuHidden, setTofuHidden] = useState<string[]>(plan.TOFU.hiddenSeqs);
  const [base, setBase] = useState<Record<AnyCat, string | null>>(() => ({
    FRUIT: plan.FRUIT.updatedAt,
    VEG: plan.VEG.updatedAt,
    TOOL: plan.TOOL.updatedAt,
    TOFU: plan.TOFU.updatedAt,
  }));
  const [msg, setMsg] = useState<Msg>(null);
  const [errAt, setErrAt] = useState<{ cat: AnyCat; index: number } | null>(null);
  const [askLoad, setAskLoad] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [open, setOpen] = useState<Record<string, boolean>>({}); // 지점별 펼침
  const [pickFor, setPickFor] = useState<string>(""); // 재고 고르기 열린 줄 key("+new"=새 줄)
  const [pickQ, setPickQ] = useState("");
  const [focusKey, setFocusKey] = useState<string>("");
  const nameRefs = useRef(new Map<string, HTMLInputElement>());

  // 저장 뒤 서버 값이 바뀌면(새로고침) 초안을 새 값으로 맞춘다 — 탭·안내는 그대로.
  const [stamp, setStamp] = useState(props.stamp);
  if (props.stamp !== stamp) {
    setStamp(props.stamp);
    setRows(initRows(plan));
    setTofuHidden(plan.TOFU.hiddenSeqs);
    setTouched({ FRUIT: false, VEG: false, TOOL: false, TOFU: false });
    setBase({ FRUIT: plan.FRUIT.updatedAt, VEG: plan.VEG.updatedAt, TOOL: plan.TOOL.updatedAt, TOFU: plan.TOFU.updatedAt });
  }

  useEffect(() => {
    if (!focusKey) return;
    const el = nameRefs.current.get(focusKey);
    if (el) {
      el.focus();
      setFocusKey("");
    }
  }, [focusKey, rows]);

  const invById = useMemo(() => new Map(inv.map((i) => [i.id, i])), [inv]);
  const invByName = useMemo(() => new Map(inv.map((i) => [normName(i.name), i.name])), [inv]);
  // 발주가 들어간 원래 줄의 연동 재고 — 그 줄은 지워도 숨김으로 남으니 다른 줄에 다시 고르지 못하게
  const orderedLinks = useMemo(
    () => plan.TOOL.items.filter((o) => o.inventoryItemId && (stats[o.id]?.total ?? 0) > 0).map((o) => o.inventoryItemId),
    [plan, stats],
  );
  // 수기 공구 이름이 재고현황 이름과 같으면 안내(서버도 거절). 숨긴 채 그대로인 옛 수기 줄은 뺀다.
  const nameClash = (r: Row): string | undefined => {
    if (r.inventoryItemId) return undefined;
    const same = invByName.get(normName(r.name));
    if (!same) return undefined;
    const o = r.id ? plan.TOOL.items.find((x) => x.id === r.id) : undefined;
    if (r.hidden && o && !o.inventoryItemId && o.name === normName(r.name)) return undefined;
    return same;
  };

  const changes = useMemo(() => {
    const out: Record<AnyCat, number> = { FRUIT: 0, VEG: 0, TOOL: 0, TOFU: 0 };
    for (const c of ITEM_CATS) {
      const n = diffCount(c, plan[c].items, rows[c]);
      out[c] = n > 0 ? n : !plan[c].exists && touched[c] ? 1 : 0;
    }
    const a = new Set(plan.TOFU.hiddenSeqs);
    const b = new Set(tofuHidden);
    out.TOFU = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
    return out;
  }, [plan, rows, touched, tofuHidden]);
  const totalChanges = ALL_CATS.reduce((s, c) => s + changes[c], 0);
  const dirty = totalChanges > 0;

  useEffect(() => {
    if (!dirty || readOnly) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty, readOnly]);

  const countOf = (c: AnyCat) =>
    c === "TOFU" ? props.tofuCatalog.length - tofuHidden.length : rows[c].filter((r) => !r.hidden).length;

  // ── 줄 편집 ──
  const setCatRows = (c: ItemCat, fn: (rs: Row[]) => Row[]) => {
    setRows((all) => ({ ...all, [c]: fn(all[c]) }));
    setTouched((t) => ({ ...t, [c]: true }));
    setErrAt(null);
  };
  const patch = (c: ItemCat, key: string, p: Partial<Row>) =>
    setCatRows(c, (rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const move = (c: ItemCat, idx: number, d: -1 | 1) =>
    setCatRows(c, (rs) => {
      const j = idx + d;
      if (j < 0 || j >= rs.length) return rs;
      const a = [...rs];
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });
  const remove = (c: ItemCat, key: string) => setCatRows(c, (rs) => rs.filter((r) => r.key !== key));
  const addRow = (c: ItemCat, after?: number) => {
    const r = blankRow();
    setCatRows(c, (rs) => {
      const a = [...rs];
      a.splice(after === undefined ? a.length : after + 1, 0, r);
      return a;
    });
    setFocusKey(r.key);
  };
  const pickInv = (key: string, i: InvPick) => {
    const p: Partial<Row> = {
      inventoryItemId: i.id,
      name: i.name,
      price: String(i.supplyPrice || ""),
      tax: i.tax,
      brokenLink: false,
    };
    if (key === "+new") {
      const r = { ...blankRow(), ...p };
      setCatRows("TOOL", (rs) => [...rs, r]);
    } else {
      patch("TOOL", key, p);
    }
    setPickFor("");
    setPickQ("");
  };

  // ── 저장 ──
  const save = () => {
    if (!dirty || readOnly) return;
    // 화면에서 먼저 막을 수 있는 것: 이름 빈 줄
    for (const c of ITEM_CATS) {
      if (changes[c] === 0) continue;
      const i = rows[c].findIndex((r) => !normName(r.name) && !r.inventoryItemId);
      if (i >= 0) {
        setTab(c);
        setErrAt({ cat: c, index: i });
        setMsg({ kind: "error", lines: [`${CAT_LABEL[c]} ${i + 1}번째 줄에 품목명을 넣어 주세요. 필요 없으면 − 로 지워 주세요.`] });
        return;
      }
    }
    const input: SaveDayPlanInput = { date, cats: {}, base: {} };
    for (const c of ITEM_CATS) {
      if (changes[c] === 0) continue;
      input.cats[c] = rows[c].map((r) => toDraft(c, r));
      input.base[c] = base[c];
    }
    if (changes.TOFU > 0) {
      input.cats.TOFU = { hiddenSeqs: tofuHidden };
      input.base.TOFU = base.TOFU;
    }
    setMsg(null);
    start(async () => {
      const res = await saveDayPlanAction(input).catch(() => ({
        ok: false as const,
        error: "저장 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
        cat: undefined,
        index: undefined,
      }));
      if (!res.ok) {
        if (res.cat) setTab(res.cat);
        if (res.cat && res.index !== undefined) setErrAt({ cat: res.cat, index: res.index });
        setMsg({ kind: "error", lines: [res.error] });
        return;
      }
      setBase((b) => ({ ...b, ...res.updatedAt }));
      const lines = ["저장했어요.", ...res.notices, ...res.warnings];
      setMsg({ kind: res.warnings.length > 0 || res.notices.length > 0 ? "warn" : "ok", lines });
      router.refresh();
    });
  };

  // ── 전날 불러오기 ──
  const src = props.prevSources[tab];
  const doLoad = () => {
    const cat = tab;
    setMsg(null);
    start(async () => {
      const r = await loadPrevPlanAction(date, cat).catch(() => ({ ok: false as const, error: "불러오지 못했어요." }));
      if (!r.ok) {
        setMsg({ kind: "error", lines: [r.error] });
        return;
      }
      if (!r.sourceDate) {
        setMsg({ kind: "warn", lines: r.notes });
        return;
      }
      if (cat === "TOFU") {
        setTofuHidden(r.hiddenSeqs ?? []);
        setTouched((t) => ({ ...t, TOFU: true }));
      } else {
        // 이미 있는 줄(같은 이름)은 그 줄을 이어 쓴다 — 발주가 들어간 줄이 지워지지 않게
        const cur = rows[cat];
        const byName = new Map(cur.filter((x) => x.id).map((x) => [normName(x.name), x]));
        const next = (r.items ?? []).map((d) => {
          const row = toRow(d);
          const same = byName.get(normName(d.name));
          return same ? { ...row, id: same.id } : row;
        });
        setCatRows(cat, () => next);
      }
      setMsg({
        kind: r.notes.length ? "warn" : "ok",
        lines: [`${props.prevSources[cat]?.label ?? r.sourceDate} 편성을 불러왔어요. 숫자를 고친 뒤 저장해 주세요.`, ...r.notes],
      });
    });
  };
  const onLoadClick = () => {
    const hasCur = tab === "TOFU" ? tofuHidden.length > 0 : rows[tab].length > 0;
    if (hasCur) setAskLoad(true);
    else doLoad();
  };

  const catRows = tab === "TOFU" ? [] : rows[tab];
  const exists = plan[tab].exists;

  return (
    <div className={`oplan-ed ${readOnly ? "is-readonly" : ""}`}>
      {/* 날짜 이동 */}
      <div className="oplan-ed__nav">
        <Link href={`/admin/order-plan/${props.prevKey}`} className="oplan-ed__arrow" aria-label="이전 발주창">
          ‹
        </Link>
        <div className="oplan-ed__date">
          <b>
            {props.label}
            {props.isToday && <span className="oplan-tag">지금 발주창</span>}
            {readOnly && <span className="oplan-tag oplan-tag--mute">지난 창</span>}
          </b>
          <small>{props.shipLabel}</small>
        </div>
        <Link href={`/admin/order-plan/${props.nextKey}`} className="oplan-ed__arrow" aria-label="다음 발주창">
          ›
        </Link>
      </div>
      <div className="oplan-ed__links">
        <Link href={props.monthHref} className="tbtn">
          달력으로
        </Link>
        <Link href={`/admin/order-plan/${date}/preview`} className="tbtn">
          점주 화면 미리보기 →
        </Link>
      </div>

      {readOnly && <div className="notice notice--mute oplan-ed__ro">지난 발주창이라 읽기 전용이에요.</div>}

      {/* 종류 탭 */}
      <div className="cattabs cattabs--seg oplan-ed__tabs">
        {ALL_CATS.map((c) => (
          <button
            key={c}
            type="button"
            className={`cattab ${tab === c ? "is-active" : ""}`}
            onClick={() => {
              setTab(c);
              setPickFor("");
            }}
          >
            {CAT_LABEL[c]}
            <span className="cattab__count">{countOf(c)}</span>
            {changes[c] > 0 && <span className="oplan-ed__dirty" aria-label="바뀜" />}
          </button>
        ))}
      </div>

      {!readOnly && (
        <div className="oplan-ed__tools">
          <button type="button" className="btn btn--xs btn--soft" onClick={onLoadClick} disabled={pending || !src}>
            {src ? `전날 불러오기 · ${src.label} ${src.count}개` : "불러올 지난 편성 없음"}
          </button>
          <button
            type="button"
            className="btn btn--xs btn--ghost"
            onClick={() => setCopyOpen(true)}
            disabled={pending || props.copyTargets.length === 0}
          >
            여러 날에 적용
          </button>
        </div>
      )}

      {msg && (
        <div className={`notice ${msg.kind === "error" ? "notice--error" : msg.kind === "warn" ? "notice--edit" : "notice--ok"} oplan-ed__msg`}>
          {msg.lines.map((l, i) => (
            <div key={i}>{l}</div>
          ))}
        </div>
      )}

      {tab === "TOFU" ? (
        <TofuPane
          catalog={props.tofuCatalog}
          hidden={tofuHidden}
          exists={plan.TOFU.exists || touched.TOFU}
          readOnly={readOnly}
          boxes={showStats ? props.tofuBoxes : null}
          onToggle={(seq) => {
            setTofuHidden((h) => (h.includes(seq) ? h.filter((x) => x !== seq) : [...h, seq]));
            setTouched((t) => ({ ...t, TOFU: true }));
          }}
        />
      ) : (
        <>
          {!exists && catRows.length === 0 && (
            <div className="oplan-empty">
              {touched[tab] ? (
                <>
                  <b>0개로 저장해요.</b> 이날 점주 화면에서 {CAT_LABEL[tab]} 발주가 닫혀요.
                </>
              ) : (
                <>
                  <b>아직 편성 전이에요.</b> 이대로 두면 이날 점주 화면에서 {CAT_LABEL[tab]} 발주가 닫혀요.
                  {!readOnly && (
                    <button
                      type="button"
                      className="tbtn"
                      onClick={() => setTouched((t) => ({ ...t, [tab]: true }))}
                      style={{ marginLeft: 6 }}
                    >
                      &lsquo;발주 없음&rsquo;으로 정하기
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          {exists && catRows.length === 0 && (
            <div className="oplan-empty">
              <b>0개</b> — 이날 {CAT_LABEL[tab]} 발주는 닫혀요.
            </div>
          )}

          <div className="oplan-rows">
            {catRows.map((r, i) => (
              <ItemRow
                key={r.key}
                cat={tab}
                row={r}
                index={i}
                count={catRows.length}
                readOnly={readOnly}
                pending={pending}
                error={errAt?.cat === tab && errAt.index === i}
                stat={r.id ? stats[r.id] : undefined}
                showStats={showStats}
                inv={r.inventoryItemId ? invById.get(r.inventoryItemId) : undefined}
                nameClash={tab === "TOOL" ? nameClash(r) : undefined}
                open={!!open[r.key]}
                onOpen={() => setOpen((o) => ({ ...o, [r.key]: !o[r.key] }))}
                setNameEl={(el) => {
                  if (el) nameRefs.current.set(r.key, el);
                  else nameRefs.current.delete(r.key);
                }}
                onPatch={(p) => patch(tab, r.key, p)}
                onMove={(d) => move(tab, i, d)}
                onRemove={() => remove(tab, r.key)}
                onEnter={() => {
                  const nx = catRows[i + 1];
                  if (nx) setFocusKey(nx.key);
                  else addRow(tab, i);
                }}
                picking={pickFor === r.key}
                onPickOpen={() => {
                  setPickFor(pickFor === r.key ? "" : r.key);
                  setPickQ("");
                }}
                picker={
                  pickFor === r.key ? (
                    <InvPicker
                      q={pickQ}
                      setQ={setPickQ}
                      inv={inv}
                      usedIds={
                        new Set([...orderedLinks, ...rows.TOOL.filter((x) => x.key !== r.key).map((x) => x.inventoryItemId).filter(Boolean)])
                      }
                      onPick={(it) => pickInv(r.key, it)}
                    />
                  ) : null
                }
              />
            ))}
          </div>

          {!readOnly && (
            <div className="oplan-add">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => addRow(tab as ItemCat)} disabled={pending}>
                + 품목 추가
              </button>
              {tab === "TOOL" && (
                <button
                  type="button"
                  className="btn btn--sm btn--soft"
                  onClick={() => {
                    setPickFor(pickFor === "+new" ? "" : "+new");
                    setPickQ("");
                  }}
                  disabled={pending}
                >
                  + 재고에서 고르기
                </button>
              )}
            </div>
          )}
          {tab === "TOOL" && pickFor === "+new" && (
            <InvPicker
              q={pickQ}
              setQ={setPickQ}
              inv={inv}
              usedIds={new Set([...orderedLinks, ...rows.TOOL.map((x) => x.inventoryItemId).filter(Boolean)])}
              onPick={(it) => pickInv("+new", it)}
            />
          )}
          {!readOnly && (
            <p className="oplan-hint">
              재고수량·최대를 비우면 제한 없음이에요. 0 은 품절. 발주가 들어간 품목은 지우면 숨김으로 바뀌어요.
              {tab === "TOOL" && " 재고 연동 공구는 실재고를 넘어서 받지 않아요."}
            </p>
          )}
        </>
      )}

      {/* 고정 저장 줄 */}
      {!readOnly && (
        <div className="oplan-savebar">
          <span className="oplan-savebar__count">
            {dirty ? (
              <>
                <span>
                  변경 <b>{totalChanges}</b>건
                </span>
                <small>
                  {ALL_CATS.filter((c) => changes[c] > 0)
                    .map((c) => `${CAT_LABEL[c]} ${changes[c]}`)
                    .join(" · ")}
                </small>
              </>
            ) : (
              "바뀐 것 없음"
            )}
          </span>
          <button type="button" className="btn btn--primary" onClick={save} disabled={pending || !dirty}>
            {pending ? "저장 중…" : "저장"}
          </button>
        </div>
      )}

      {askLoad && (
        <ConfirmSheet
          title={`지금 ${CAT_LABEL[tab]} 목록을 ${src?.label ?? "지난"} 편성으로 바꿀까요? 저장하기 전에는 실제로 바뀌지 않아요.`}
          confirmLabel="불러오기"
          onConfirm={doLoad}
          onClose={() => setAskLoad(false)}
        />
      )}

      {copyOpen && (
        <CopySheet
          date={date}
          label={props.label}
          tab={tab}
          dirty={dirty}
          plan={plan}
          targets={props.copyTargets}
          onClose={() => setCopyOpen(false)}
          onDone={(lines) => {
            setMsg({ kind: "ok", lines });
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// ── 품목 카드 ────────────────────────────────────────────────

type ItemRowProps = {
  cat: ItemCat;
  row: Row;
  index: number;
  count: number;
  readOnly: boolean;
  pending: boolean;
  error: boolean;
  stat?: ItemStat;
  showStats: boolean;
  inv?: InvPick;
  nameClash?: string; // 수기 공구 이름과 같은 재고현황 이름
  open: boolean;
  onOpen: () => void;
  setNameEl: (el: HTMLInputElement | null) => void;
  onPatch: (p: Partial<Row>) => void;
  onMove: (d: -1 | 1) => void;
  onRemove: () => void;
  onEnter: () => void;
  picking: boolean;
  onPickOpen: () => void;
  picker: React.ReactNode;
};

function ItemRow({ setNameEl, ...p }: ItemRowProps) {
  const { cat, row: r, readOnly, stat } = p;
  const linked = cat === "TOOL" && !!r.inventoryItemId;
  const stockN = strNum(r.stock);
  const real = stat?.real ?? p.inv?.real ?? null;
  const remain =
    stat && r.id ? stat.remaining : linked ? (stockN === null ? real : real === null ? stockN : Math.min(stockN, real)) : stockN;
  const used = stat?.total ?? 0;
  const numIn = (v: string, set: (s: string) => void, label: string, ph = "제한 없음") => (
    <label className="oplan-num">
      <span>{label}</span>
      <input
        className="input"
        inputMode="numeric"
        value={v}
        placeholder={ph}
        disabled={readOnly}
        onChange={(e) => set(e.target.value.replace(/[^\d]/g, ""))}
      />
    </label>
  );

  return (
    <div className={`oplan-row ${r.hidden ? "is-hidden" : ""} ${p.error ? "is-error" : ""}`}>
      <div className="oplan-row__top">
        <span className="oplan-row__no">{p.index + 1}</span>
        <input
          ref={setNameEl}
          className="input oplan-row__name"
          value={r.name}
          placeholder={cat === "TOOL" ? "공구 품목명" : `${CAT_LABEL[cat]} 품목명 (예: 양파(소))`}
          maxLength={60}
          disabled={readOnly || linked}
          onChange={(e) => p.onPatch({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              p.onEnter();
            }
          }}
        />
        <button
          type="button"
          className={`ocfg-pill ${r.hidden ? "ocfg-pill--off" : "ocfg-pill--on"}`}
          onClick={() => p.onPatch({ hidden: !r.hidden })}
          disabled={readOnly}
        >
          {r.hidden ? "숨김" : "보이기"}
        </button>
      </div>

      <div className="oplan-row__nums">
        {numIn(r.stock, (s) => p.onPatch({ stock: s }), "재고수량")}
        {numIn(r.max, (s) => p.onPatch({ max: s }), "지점당 최대")}
        {cat === "TOOL" && numIn(r.min, (s) => p.onPatch({ min: s }), "최소", "없음")}
      </div>

      <input
        className="input oplan-row__desc"
        value={r.description}
        placeholder="설명 (점주 화면에만 보여요)"
        maxLength={200}
        disabled={readOnly}
        onChange={(e) => p.onPatch({ description: e.target.value })}
      />

      {cat === "TOOL" && (
        <div className="oplan-row__tool">
          {linked ? (
            <div className="flatinv__picked oplan-row__linked">
              <span>
                재고연동 · 실재고 <b>{real ?? "?"}</b>
                {remain !== null && (
                  <>
                    {" "}
                    · 남은 <b>{remain}</b>
                  </>
                )}
                {p.inv?.locked && <em className="oplan-warn"> · 예약 진행 중</em>}
              </span>
              {!readOnly && !(used > 0) && (
                <button type="button" className="btn btn--xs btn--ghost" onClick={() => p.onPatch({ inventoryItemId: "" })}>
                  연동 해제
                </button>
              )}
            </div>
          ) : (
            <>
              {r.brokenLink && <div className="oplan-warn">연동 끊김 — 재고를 찾지 못해 수기 공구로 바꿨어요.</div>}
              {!readOnly && p.nameClash && (
                <div className="oplan-warn">
                  재고현황의 &lsquo;{p.nameClash}&rsquo;과 이름이 같아요. 재고 연동으로 넣거나 이름을 바꿔 주세요.
                </div>
              )}
              <div className="oplan-row__manual">
                <MoneyInput value={r.price} onChange={(v) => p.onPatch({ price: v })} placeholder="공급가(원)" disabled={readOnly} />
                <select
                  className="input"
                  value={r.tax}
                  disabled={readOnly}
                  onChange={(e) => p.onPatch({ tax: e.target.value })}
                  aria-label="과세"
                >
                  <option value="">과세 선택</option>
                  <option value="TAXABLE">과세</option>
                  <option value="EXEMPT">면세</option>
                </select>
                {!readOnly && !(used > 0) && (
                  <button type="button" className="btn btn--xs btn--soft" onClick={p.onPickOpen}>
                    {p.picking ? "닫기" : "재고에서 고르기"}
                  </button>
                )}
              </div>
              {p.picker}
            </>
          )}
        </div>
      )}

      {p.showStats && r.id && stat && (
        <div className="oplan-row__stat">
          <button type="button" className="oplan-row__statbtn" onClick={p.onOpen} disabled={stat.storeCount === 0}>
            발주 <b>{stat.total}</b> / 재고 {r.stock === "" ? "제한 없음" : r.stock} · {stat.storeCount}곳
            {stat.remaining !== null && <> · 남은 {stat.remaining}</>}
            {stat.storeCount > 0 && <span className="oplan-row__caret">{p.open ? "▴" : "▾"}</span>}
          </button>
          {p.open && (
            <div className="oplan-row__stores">
              {stat.byStore.map((s, i) => (
                <Fragment key={i}>
                  <span>{s.storeName}</span>
                  <b>{s.qty}</b>
                </Fragment>
              ))}
            </div>
          )}
        </div>
      )}

      {!readOnly && (
        <div className="oplan-row__acts">
          {used > 0 && <span className="oplan-row__note">발주 {used}개 들어옴 — 지우면 숨김</span>}
          <span className="ocfg-item__sp" />
          <button type="button" className="tbtn tbtn--ord" onClick={() => p.onMove(-1)} disabled={p.index === 0} aria-label="위로">
            ▲
          </button>
          <button
            type="button"
            className="tbtn tbtn--ord"
            onClick={() => p.onMove(1)}
            disabled={p.index === p.count - 1}
            aria-label="아래로"
          >
            ▼
          </button>
          <button type="button" className="oplan-row__del" onClick={p.onRemove} aria-label="삭제">
            −
          </button>
        </div>
      )}
    </div>
  );
}

// ── 재고 고르기(FlatReservationAdmin 검색 방식) ─────────────────

function InvPicker({
  q,
  setQ,
  inv,
  usedIds,
  onPick,
}: {
  q: string;
  setQ: (s: string) => void;
  inv: InvPick[];
  usedIds: Set<string>;
  onPick: (i: InvPick) => void;
}) {
  const t = q.trim();
  const matches = t ? inv.filter((i) => i.name.includes(t)).slice(0, 8) : [];
  return (
    <div className="flatinv oplan-picker">
      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="재고 품목명 검색" autoFocus />
      {t && (
        <div className="flatinv__results">
          {matches.length === 0 ? (
            <div className="flatinv__none">검색 결과 없음</div>
          ) : (
            matches.map((i) => {
              const used = usedIds.has(i.id);
              const off = i.locked || used;
              return (
                <button
                  type="button"
                  key={i.id}
                  className={`flatinv__opt ${off ? "is-off" : ""}`}
                  disabled={off}
                  onClick={() => onPick(i)}
                >
                  <span>{i.name}</span>
                  <span className="flatinv__price">
                    {i.locked ? "예약 진행 중" : used ? "이미 연동됨" : `실재고 ${i.real}`}
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ── 채움채 ──────────────────────────────────────────────────

function TofuPane({
  catalog,
  hidden,
  exists,
  readOnly,
  boxes,
  onToggle,
}: {
  catalog: { seq: string; name: string }[];
  hidden: string[];
  exists: boolean;
  readOnly: boolean;
  boxes: Record<string, number> | null;
  onToggle: (seq: string) => void;
}) {
  return (
    <>
      {!exists && <div className="oplan-empty">편성 전이면 점주 화면에 4개 모두 보여요.</div>}
      <div className="oplan-rows">
        {catalog.map((p, i) => {
          const off = hidden.includes(p.seq);
          return (
            <div key={p.seq} className={`oplan-row oplan-row--tofu ${off ? "is-hidden" : ""}`}>
              <div className="oplan-row__top">
                <span className="oplan-row__no">{i + 1}</span>
                <span className="oplan-row__tname">{p.name}</span>
                {boxes && <span className="oplan-row__boxes">들어온 {boxes[p.seq] ?? 0}박스</span>}
                <button
                  type="button"
                  className={`ocfg-pill ${off ? "ocfg-pill--off" : "ocfg-pill--on"}`}
                  onClick={() => onToggle(p.seq)}
                  disabled={readOnly}
                >
                  {off ? "숨김" : "보이기"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="oplan-hint">숨겨도 이미 들어온 채움채 발주는 저녁 8시 5분 자동발주에 그대로 들어가요.</p>
    </>
  );
}

// ── 여러 날에 적용 ───────────────────────────────────────────

function CopySheet({
  date,
  label,
  tab,
  dirty,
  plan,
  targets,
  onClose,
  onDone,
}: {
  date: string;
  label: string;
  tab: AnyCat;
  dirty: boolean;
  plan: EditorPlan;
  targets: { key: string; label: string; planned: Record<AnyCat, boolean> }[];
  onClose: () => void;
  onDone: (lines: string[]) => void;
}) {
  const [cats, setCats] = useState<AnyCat[]>([tab]);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<"skip" | "replace">("skip");
  const [err, setErr] = useState("");
  const [result, setResult] = useState<string[] | null>(null);
  const [pending, start] = useTransition();

  const has = (c: AnyCat) => plan[c].exists;
  const run = () => {
    setErr("");
    start(async () => {
      const r = await copyPlanAction({ fromDate: date, toDates: picked, cats, mode }).catch(() => ({
        ok: false as const,
        error: "적용하지 못했어요. 잠시 후 다시 시도해 주세요.",
      }));
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      const lines = [`${new Set(r.done.map((d) => d.date)).size}개 발주창에 적용했어요.`];
      const lab = (k: string) => targets.find((t) => t.key === k)?.label ?? k;
      for (const s of r.skipped) lines.push(`${lab(s.date)} ${CAT_LABEL[s.cat]} — ${s.reason}`);
      lines.push(...r.notes);
      setResult(lines);
      onDone(lines);
    });
  };

  return (
    <Sheet onClose={() => !pending && onClose()}>
      <div className="sheet__panel" style={{ maxWidth: 520 }}>
        <div className="sheet__head">
          <div className="sheet__title">여러 날에 적용</div>
          <button type="button" className="sheet__close" aria-label="닫기" onClick={onClose} disabled={pending}>
            ✕
          </button>
        </div>
        <div className="sheet__hint">{label} 저장된 편성을 고른 날에 그대로 넣어요(숨긴 품목 빼고).</div>
        <div className="sheet__body">
          {dirty && <div className="notice notice--edit">저장하지 않은 변경이 있어요. 먼저 저장해야 그 내용이 적용돼요.</div>}
          {result ? (
            <div className="notice notice--ok">
              {result.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          ) : (
            <>
              <div className="section-label">종류</div>
              <div className="oplan-copy__cats">
                {ALL_CATS.map((c) => (
                  <label key={c} className={`oplan-check ${!has(c) ? "is-off" : ""}`}>
                    <input
                      type="checkbox"
                      checked={cats.includes(c)}
                      disabled={!has(c)}
                      onChange={(e) => setCats((s) => (e.target.checked ? [...s, c] : s.filter((x) => x !== c)))}
                    />
                    <span>
                      {CAT_LABEL[c]}
                      {!has(c) && " (편성 없음)"}
                    </span>
                  </label>
                ))}
              </div>
              <div className="section-label" style={{ marginTop: 12 }}>
                적용할 발주창
              </div>
              <div className="oplan-copy__dates">
                {targets.map((t) => {
                  const already = cats.filter((c) => t.planned[c]);
                  return (
                    <label key={t.key} className={`oplan-copy__date ${picked.includes(t.key) ? "is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={picked.includes(t.key)}
                        onChange={(e) => setPicked((s) => (e.target.checked ? [...s, t.key] : s.filter((x) => x !== t.key)))}
                      />
                      <span>{t.label}</span>
                      {already.length > 0 && <small>{already.map((c) => CAT_LABEL[c]).join("·")} 편성됨</small>}
                    </label>
                  );
                })}
              </div>
              <div className="section-label" style={{ marginTop: 12 }}>
                이미 편성된 날은
              </div>
              <div className="oplan-radio">
                <label className={mode === "skip" ? "is-on" : ""}>
                  <input type="radio" checked={mode === "skip"} onChange={() => setMode("skip")} />
                  <span>
                    <b>건너뛰기</b> (추천)
                  </span>
                </label>
                <label className={mode === "replace" ? "is-on" : ""}>
                  <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} />
                  <span>
                    <b>덮어쓰기</b>
                    <small>그날 그 종류에 발주가 하나도 없을 때만 덮어써요.</small>
                  </span>
                </label>
              </div>
              {err && (
                <div className="notice notice--error" style={{ marginTop: 10 }}>
                  {err}
                </div>
              )}
            </>
          )}
        </div>
        <div className="sheet__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={pending}>
            {result ? "닫기" : "취소"}
          </button>
          {!result && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={run}
              disabled={pending || cats.length === 0 || picked.length === 0}
            >
              {pending ? "적용 중…" : `${picked.length}개 창에 적용`}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
