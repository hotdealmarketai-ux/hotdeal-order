"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { expiryInfo } from "@/lib/date";
import {
  createBox,
  deleteBox,
  listBoxes,
  updateBox,
  type BoxDTO,
} from "@/app/actions/warehouse";

type Item = { id: string; name: string; qty: number; expiry: string };

const norm = (s: string) => s.replace(/\s/g, "");

const LOCATIONS = [
  { key: "FLOOR1", label: "1층" },
  { key: "FREEZER", label: "냉동고" },
  { key: "FRIDGE", label: "냉장고" },
] as const;

// 캔버스 논리 크기(평면도) — 스크롤로 넓게 사용. 스냅 시 캔버스 가장자리/중앙 기준도 됨.
const CANVAS = { w: 1600, h: 1000 };
const SNAP = 6; // 스냅 임계(px)
const MIN = 40; // 최소 박스 크기(px)

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Active =
  | { mode: "drag"; id: string; sx: number; sy: number; box: BoxDTO }
  | { mode: "resize"; id: string; handle: Handle; sx: number; sy: number; box: BoxDTO };

type Rect = { x: number; y: number; w: number; h: number };

// ── 드래그 스냅: moving 사각형의 좌/중/우, 상/중/하를 다른 박스·캔버스에 맞춘다 ──
function snapDrag(m: Rect, others: Rect[]) {
  let x = m.x,
    y = m.y;
  const v: number[] = [],
    h: number[] = [];
  const vT = [0, CANVAS.w / 2, CANVAS.w, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const hT = [0, CANVAS.h / 2, CANVAS.h, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const vA: [number, number][] = [[m.x, 0], [m.x + m.w / 2, m.w / 2], [m.x + m.w, m.w]];
  let bv: { d: number; x: number; l: number } | null = null;
  for (const [pos, off] of vA)
    for (const t of vT) {
      const d = Math.abs(pos - t);
      if (d <= SNAP && (!bv || d < bv.d)) bv = { d, x: t - off, l: t };
    }
  if (bv) {
    x = bv.x;
    v.push(bv.l);
  }
  const hA: [number, number][] = [[m.y, 0], [m.y + m.h / 2, m.h / 2], [m.y + m.h, m.h]];
  let bh: { d: number; y: number; l: number } | null = null;
  for (const [pos, off] of hA)
    for (const t of hT) {
      const d = Math.abs(pos - t);
      if (d <= SNAP && (!bh || d < bh.d)) bh = { d, y: t - off, l: t };
    }
  if (bh) {
    y = bh.y;
    h.push(bh.l);
  }
  return { x, y, v, h };
}

// ── 리사이즈 스냅: 움직이는 모서리(handle 방향)만 다른 박스·캔버스에 맞춘다 ──
function snapResize(handle: Handle, box: BoxDTO, dx: number, dy: number, others: Rect[]) {
  let { x, y, w, h } = box;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const vT = [0, CANVAS.w, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const hT = [0, CANVAS.h, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
  const vg: number[] = [],
    hg: number[] = [];
  if (east) {
    let right = box.x + box.w + dx;
    for (const t of vT)
      if (Math.abs(right - t) <= SNAP) {
        right = t;
        vg.push(t);
        break;
      }
    w = Math.max(MIN, right - box.x);
  }
  if (west) {
    let left = box.x + dx;
    for (const t of vT)
      if (Math.abs(left - t) <= SNAP) {
        left = t;
        vg.push(t);
        break;
      }
    const right = box.x + box.w;
    left = Math.min(left, right - MIN);
    x = Math.max(0, left);
    w = right - x;
  }
  if (south) {
    let bottom = box.y + box.h + dy;
    for (const t of hT)
      if (Math.abs(bottom - t) <= SNAP) {
        bottom = t;
        hg.push(t);
        break;
      }
    h = Math.max(MIN, bottom - box.y);
  }
  if (north) {
    let top = box.y + dy;
    for (const t of hT)
      if (Math.abs(top - t) <= SNAP) {
        top = t;
        hg.push(t);
        break;
      }
    const bottom = box.y + box.h;
    top = Math.min(top, bottom - MIN);
    y = Math.max(0, top);
    h = bottom - y;
  }
  return { x, y, w, h, vg, hg };
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function WarehouseBoard({
  storeName,
  items,
  initialLocation,
  initialBoxes,
  todayCount,
  todayStores,
  todayItemNames,
}: {
  storeName: string;
  items: Item[];
  initialLocation: string;
  initialBoxes: BoxDTO[];
  todayCount: number;
  todayStores: string[];
  todayItemNames: string[];
}) {
  const [location, setLocation] = useState<string>(initialLocation);
  const [boxes, setBoxes] = useState<BoxDTO[]>(initialBoxes);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [q, setQ] = useState("");
  const [showIntro, setShowIntro] = useState(true); // #12 로그인 인트로(오늘 발주 요약)
  const [expiryOn, setExpiryOn] = useState(false); // #12 유통기한 임박(-30일) 하이라이트 토글

  // 품목 id → 정보(유통기한 임박 판정용). 오늘 발주 품목명(정규화) 집합.
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const todaySet = useMemo(() => new Set(todayItemNames), [todayItemNames]);
  // 박스가 '오늘 발주 품목'인지 — 라벨 정규화 후 오늘 품목명과 포함관계(느슨 매칭, 반짝 힌트용).
  const isTodayBox = (label: string) => {
    const n = norm(label);
    if (n.length < 2) return false;
    if (todaySet.has(n)) return true;
    for (const t of todaySet) if (t.includes(n) || n.includes(t)) return true;
    return false;
  };
  // 박스의 품목이 유통기한 임박(≤30일)/만료인지 — itemId로 재고 조회 후 expiryInfo.
  const isExpiryBox = (b: BoxDTO) => {
    if (!b.itemId) return false;
    const info = expiryInfo(itemById.get(b.itemId)?.expiry ?? "");
    return !!info && (info.level === "soon" || info.level === "expired");
  };

  const active = useRef<Active | null>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;

  // 위치 전환 — 해당 위치 박스 로드
  const switchLocation = async (loc: string) => {
    if (loc === location || active.current) return;
    setLocation(loc);
    setSelected(null);
    setLoading(true);
    const rows = await listBoxes(loc).catch(() => [] as BoxDTO[]);
    setBoxes(rows);
    setLoading(false);
  };

  // 팔레트 품목 → 박스 추가(계단식 오프셋으로 겹침 방지)
  const addItem = async (it: Item) => {
    const n = boxesRef.current.length;
    const res = await createBox({
      location,
      itemId: it.id,
      label: it.name,
      x: 40 + (n % 8) * 26,
      y: 40 + (n % 8) * 26,
    }).catch(() => null);
    if (res?.ok && res.box) {
      setBoxes((b) => [...b, res.box!]);
      setSelected(res.box.id);
    }
  };

  const removeBox = async (id: string) => {
    setBoxes((b) => b.filter((x) => x.id !== id));
    if (selectedRef.current === id) setSelected(null);
    await deleteBox(id).catch(() => {});
  };

  const renameBox = async (box: BoxDTO) => {
    const next = window.prompt("이름 변경", box.label)?.trim();
    if (!next || next === box.label) return;
    setBoxes((b) => b.map((x) => (x.id === box.id ? { ...x, label: next } : x)));
    await updateBox({ id: box.id, label: next }).catch(() => {});
  };

  const startDrag = (e: React.PointerEvent, box: BoxDTO) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setSelected(box.id);
    active.current = { mode: "drag", id: box.id, sx: e.clientX, sy: e.clientY, box: { ...box } };
  };
  const startResize = (e: React.PointerEvent, box: BoxDTO, handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    setSelected(box.id);
    active.current = { mode: "resize", id: box.id, handle, sx: e.clientX, sy: e.clientY, box: { ...box } };
  };

  // 전역 포인터 이동/해제 — 드래그·리사이즈 처리 + 스냅
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const a = active.current;
      if (!a) return;
      const others: Rect[] = boxesRef.current
        .filter((b) => b.id !== a.id)
        .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
      if (a.mode === "drag") {
        const s = snapDrag(
          { x: a.box.x + (e.clientX - a.sx), y: a.box.y + (e.clientY - a.sy), w: a.box.w, h: a.box.h },
          others,
        );
        setBoxes((bs) =>
          bs.map((b) => (b.id === a.id ? { ...b, x: Math.max(0, s.x), y: Math.max(0, s.y) } : b)),
        );
        setGuides({ v: s.v, h: s.h });
      } else {
        const r = snapResize(a.handle, a.box, e.clientX - a.sx, e.clientY - a.sy, others);
        setBoxes((bs) =>
          bs.map((b) => (b.id === a.id ? { ...b, x: r.x, y: r.y, w: r.w, h: r.h } : b)),
        );
        setGuides({ v: r.vg, h: r.hg });
      }
    };
    const onUp = () => {
      const a = active.current;
      if (!a) return;
      active.current = null;
      setGuides({ v: [], h: [] });
      const cur = boxesRef.current.find((b) => b.id === a.id);
      if (cur) updateBox({ id: cur.id, x: cur.x, y: cur.y, w: cur.w, h: cur.h }).catch(() => {});
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  // Delete/Backspace 로 선택 박스 삭제 (입력창 포커스 중엔 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current) {
        e.preventDefault();
        removeBox(selectedRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placedItemIds = new Set(boxes.map((b) => b.itemId).filter(Boolean));
  const filtered = q.trim()
    ? items.filter((it) => it.name.replace(/\s/g, "").includes(q.trim().replace(/\s/g, "")))
    : items;

  return (
    <div className="whwrap">
      {showIntro && (
        <div className="whintro" onClick={() => setShowIntro(false)}>
          <div className="whintro__card" onClick={(e) => e.stopPropagation()}>
            <div className="whintro__logo">📦 창고관리</div>
            <div className="whintro__count">
              오늘의 발주는 <b>{todayCount}</b>건입니다
            </div>
            {todayStores.length > 0 ? (
              <div className="whintro__stores">
                <div className="whintro__storeshd">
                  오늘 발주 넣은 지점 · {todayStores.length}곳
                </div>
                <div className="whintro__storelist">
                  {todayStores.map((s) => (
                    <span key={s} className="whintro__store">
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="whintro__none">아직 오늘 들어온 발주가 없어요.</div>
            )}
            <button
              type="button"
              className="whintro__go"
              onClick={() => setShowIntro(false)}
            >
              창고 보기 →
            </button>
            <div className="whintro__hint">
              평면도에서 오늘 발주 품목이 반짝여요.
            </div>
          </div>
        </div>
      )}
      <header className="whtop">
        <div className="whtop__brand">
          <span className="whtop__logo">📦</span>
          <span className="whtop__title">창고관리</span>
          <span className="whtop__sub">{storeName}</span>
        </div>
        <div className="whtabs">
          {LOCATIONS.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`whtab ${location === l.key ? "is-on" : ""}`}
              onClick={() => switchLocation(l.key)}
            >
              {l.label}
            </button>
          ))}
        </div>
        <div className="whtop__right">
          <button
            type="button"
            className={`whtop__expiry ${expiryOn ? "is-on" : ""}`}
            onClick={() => setExpiryOn((v) => !v)}
            title="유통기한 30일 이내(만료 포함) 품목을 평면도에서 반짝이게 표시"
          >
            ⏳ 유통기한 임박
          </button>
          <form action={logoutAction}>
            <button type="submit" className="whtop__logout">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <div className="whmain">
        <aside className="whside">
          <div className="whside__head">재고 품목</div>
          <input
            className="whside__search"
            placeholder="품목 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <div className="whpal">
            {filtered.length === 0 && <div className="whpal__empty">품목이 없어요.</div>}
            {filtered.map((it) => (
              <button
                key={it.id}
                type="button"
                className="whpal__item"
                onClick={() => addItem(it)}
                title="클릭하면 평면도에 박스로 추가돼요"
              >
                <span className="whpal__name">{it.name}</span>
                <span className="whpal__meta">
                  {placedItemIds.has(it.id) && <span className="whpal__placed">배치됨</span>}
                  <span className="whpal__qty">{it.qty}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="whside__hint">
            품목을 클릭해 추가 · 드래그로 이동 · 모서리로 크기조절 · 옆 박스에 자동정렬(스냅) · Delete로 삭제
          </div>
        </aside>

        <div className="whcanvaswrap">
          <div
            className="whcanvas"
            style={{ width: CANVAS.w, height: CANVAS.h }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) setSelected(null);
            }}
          >
            {/* 스냅 가이드선 */}
            {guides.v.map((x, i) => (
              <div key={`v${i}`} className="whguide whguide--v" style={{ left: x }} />
            ))}
            {guides.h.map((y, i) => (
              <div key={`h${i}`} className="whguide whguide--h" style={{ top: y }} />
            ))}

            {boxes.map((b) => {
              const sel = b.id === selected;
              const today = isTodayBox(b.label); // 오늘 발주 품목 → 반짝
              const expSoon = expiryOn && isExpiryBox(b); // 유통기한 임박 토글 ON + 임박
              return (
                <div
                  key={b.id}
                  className={`whbox ${sel ? "whbox--sel" : ""} ${today ? "whbox--today" : ""} ${expSoon ? "whbox--expiry" : ""}`}
                  style={{
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    zIndex: sel ? 999 : today || expSoon ? 500 + b.z : b.z,
                  }}
                  onPointerDown={(e) => startDrag(e, b)}
                  onDoubleClick={() => renameBox(b)}
                >
                  <span className="whbox__label">{b.label}</span>
                  {sel && (
                    <button
                      type="button"
                      className="whbox__del"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={() => removeBox(b.id)}
                      aria-label="삭제"
                    >
                      ✕
                    </button>
                  )}
                  {sel &&
                    HANDLES.map((hd) => (
                      <span
                        key={hd}
                        className={`whhandle whhandle--${hd}`}
                        onPointerDown={(e) => startResize(e, b, hd)}
                      />
                    ))}
                </div>
              );
            })}
          </div>
          {loading && <div className="whloading">불러오는 중…</div>}
        </div>
      </div>
    </div>
  );
}
