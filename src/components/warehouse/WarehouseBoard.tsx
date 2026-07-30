"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { logoutAction } from "@/app/actions/auth";
import { expiryInfo } from "@/lib/date";
import {
  createBox,
  deleteBox,
  listBoxes,
  updateBox,
  addLocationAction,
  renameLocationAction,
  deleteLocationAction,
  type BoxDTO,
} from "@/app/actions/warehouse";

type Item = { id: string; name: string; qty: number; expiry: string };
type LocationDTO = { id: string; name: string; boxCount: number };

// 캔버스 논리 크기(평면도) 기본값 — 사용자가 자유 리사이즈(#12) 가능, localStorage 유지.
const CANVAS_DEFAULT = { w: 1600, h: 1000 };
const CANVAS_KEY = "wh_canvas";
// 장소(위치)별 평면도 크기 — localStorage 키를 위치별로 분리(냉동고/냉장고 각각 다르게 저장).
// 값이 없으면 예전 전역 키(CANVAS_KEY)로 폴백 → 기존에 정해둔 크기를 그대로 보존한다.
const canvasKeyFor = (loc: string) => `${CANVAS_KEY}:${loc}`;
// 우클릭 셀 배경색 6종. 어두운 보드 위에서 대비되는 파스텔(검정 텍스트 가독).
const BOX_COLORS = ["#fecaca", "#fed7aa", "#fde68a", "#bbf7d0", "#bfdbfe", "#e9d5ff"];
const SNAP = 6; // 스냅 임계(px)
const MIN = 40; // 최소 박스 크기(px)

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type Active =
  | { mode: "drag"; id: string; sx: number; sy: number; box: BoxDTO; group?: BoxDTO[] }
  | { mode: "resize"; id: string; handle: Handle; sx: number; sy: number; box: BoxDTO; group?: BoxDTO[] };

type Rect = { x: number; y: number; w: number; h: number };

// ── 드래그 스냅: moving 사각형의 좌/중/우, 상/중/하를 다른 박스·캔버스에 맞춘다 ──
function snapDrag(m: Rect, others: Rect[], cw: number, ch: number) {
  let x = m.x,
    y = m.y;
  const v: number[] = [],
    h: number[] = [];
  const vT = [0, cw / 2, cw, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const hT = [0, ch / 2, ch, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
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
function snapResize(handle: Handle, box: BoxDTO, dx: number, dy: number, others: Rect[], cw: number, ch: number) {
  let { x, y, w, h } = box;
  const west = handle.includes("w");
  const east = handle.includes("e");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const vT = [0, cw, ...others.flatMap((o) => [o.x, o.x + o.w / 2, o.x + o.w])];
  const hT = [0, ch, ...others.flatMap((o) => [o.y, o.y + o.h / 2, o.y + o.h])];
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

// ── 겹침 방지(밀어내기) ── 품목 셀끼리 절대 겹치지 않게, 겹치는 쌍을 최소 침투축으로 밀어낸다.
// active(방금 옮긴/키운 박스)는 가급적 제자리, passive가 밀린다. 여러 번 반복해 연쇄 겹침까지 해소.
// 폼박스(구조물=itemId 없음, 벽/문)는 배경이라 충돌 대상에서 제외한다.
function separate(boxes: BoxDTO[], activeIds: Set<string>): BoxDTO[] {
  const arr = boxes.map((b) => ({ ...b }));
  const idx: number[] = [];
  for (let i = 0; i < arr.length; i++) if (arr[i].itemId) idx.push(i);
  const ITER = 20;
  for (let iter = 0; iter < ITER; iter++) {
    let any = false;
    for (let p = 0; p < idx.length; p++) {
      for (let q = p + 1; q < idx.length; q++) {
        const a = arr[idx[p]];
        const b = arr[idx[q]];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox <= 0 || oy <= 0) continue; // 안 겹침
        any = true;
        const aAct = activeIds.has(a.id);
        const bAct = activeIds.has(b.id);
        // 이동 배분(합=1): active는 안 움직이고 passive를 민다. 둘 다 같으면 반반.
        let wa: number, wb: number;
        if (aAct && !bAct) { wa = 0; wb = 1; }
        else if (!aAct && bAct) { wa = 1; wb = 0; }
        else { wa = 0.5; wb = 0.5; }
        if (ox < oy) {
          // 가로로 분리 — 중심이 왼쪽인 박스를 왼(-)으로, 오른쪽 박스를 오른(+)으로.
          const aLeft = a.x + a.w / 2 <= b.x + b.w / 2;
          const left = aLeft ? a : b;
          const right = aLeft ? b : a;
          left.x -= ox * (aLeft ? wa : wb);
          right.x += ox * (aLeft ? wb : wa);
        } else {
          const aTop = a.y + a.h / 2 <= b.y + b.h / 2;
          const top = aTop ? a : b;
          const bot = aTop ? b : a;
          top.y -= oy * (aTop ? wa : wb);
          bot.y += oy * (aTop ? wb : wa);
        }
      }
    }
    for (const b of arr) {
      if (b.x < 0) b.x = 0;
      if (b.y < 0) b.y = 0;
    }
    if (!any) break;
  }
  for (const b of arr) {
    b.x = Math.round(b.x);
    b.y = Math.round(b.y);
  }
  return arr;
}

const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

export function WarehouseBoard({
  storeName,
  items,
  initialLocation,
  initialBoxes,
  todayCount,
  storeFilters,
  locations,
  placedAllIds,
}: {
  storeName: string;
  items: Item[];
  initialLocation: string;
  initialBoxes: BoxDTO[];
  todayCount: number;
  // 오늘 나갈 발주가 있는 지점별 재고 품목(itemId)+발주수량. 지점 필터 버튼·팔레트 필터 소스.
  storeFilters: { storeName: string; items: { itemId: string; qty: number }[] }[];
  // 창고 장소(동적) — 관리자가 추가/이름변경/삭제. boxCount>0이면 삭제 불가.
  locations: LocationDTO[];
  // 미배치 필터용 — 전 장소(모든 위치)에서 한 번이라도 배치된 재고 품목 id(페이지 로드 스냅샷).
  placedAllIds: string[];
}) {
  const [location, setLocation] = useState<string>(initialLocation);
  const [locEdit, setLocEdit] = useState(false); // 장소 편집(추가/이름변경/삭제) 패널 토글
  const [boxes, setBoxes] = useState<BoxDTO[]>(initialBoxes);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]); // 다중 선택(드래그 셀 선택)
  const [showUnplaced, setShowUnplaced] = useState(false); // 미배치(전 장소 어디에도 없는 품목)만
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null); // 드래그 선택 사각형(캔버스 좌표)
  const [guides, setGuides] = useState<{ v: number[]; h: number[] }>({ v: [], h: [] });
  const [q, setQ] = useState("");
  const [showIntro, setShowIntro] = useState(true); // #12 로그인 인트로(오늘 발주 요약)
  const [activeStore, setActiveStore] = useState<string | null>(null); // 지점 필터(null=전체)
  const [expiryOn, setExpiryOn] = useState(false); // #12 유통기한 임박(-30일) 하이라이트 토글
  const [canvas, setCanvas] = useState(CANVAS_DEFAULT); // #12 자유 리사이즈 캔버스
  const [formEdit, setFormEdit] = useState(false); // #12 폼박스(창문/문/계단) 편집모드 — OFF면 클릭 안 됨
  const [hovered, setHovered] = useState<string | null>(null); // #12 겹침: 호버 박스를 앞으로
  const [liveQty, setLiveQty] = useState<Record<string, number>>({}); // 재고현황 실시간 남은수량
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null); // 우클릭 메뉴
  const [saved, setSaved] = useState(false); // 자동 저장 표시
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;

  // 자동 저장 표시(박스 추가/이동/리사이즈/삭제/이름변경은 즉시 DB 저장됨) — 잠깐 '자동 저장됨' 노출
  const flashSaved = () => {
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1400);
  };
  const flashSavedRef = useRef(flashSaved);
  flashSavedRef.current = flashSaved;

  // 재고현황 실시간 폴링 — 박스/팔레트의 남은수량을 재고와 같이 바꾼다(6초, 탭 숨김 시 정지).
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const res = await fetch("/api/warehouse/stock", { cache: "no-store" });
        if (res.ok) {
          const j = (await res.json()) as { qty?: Record<string, number> };
          if (!cancelled && j.qty) setLiveQty(j.qty);
        }
      } catch {
        /* noop */
      }
    };
    poll();
    const id = setInterval(poll, 6000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // 캔버스 크기 복원 — 장소(위치)별 저장값. 없으면 예전 전역값(CANVAS_KEY)로 폴백해 기존 크기 보존.
  // location이 바뀔 때마다 그 장소의 크기로 갱신 → 냉동고/냉장고 각각 다른 평면도 크기.
  useEffect(() => {
    try {
      const raw =
        localStorage.getItem(canvasKeyFor(location)) ||
        localStorage.getItem(CANVAS_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && c.w > 0 && c.h > 0) {
          setCanvas({ w: c.w, h: c.h });
          return;
        }
      }
      setCanvas(CANVAS_DEFAULT);
    } catch {
      setCanvas(CANVAS_DEFAULT);
    }
  }, [location]);

  // 품목 id → 정보(유통기한 임박 판정용). 오늘 발주 품목명(정규화) 집합.
  const itemById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  // 오늘 나갈 재고 id 집합 — 전체(모든 지점 합집합) 또는 선택 지점 하나. 박스 itemId로 반짝 판정.
  const allGlowIds = useMemo(
    () => new Set(storeFilters.flatMap((f) => f.items.map((i) => i.itemId))),
    [storeFilters],
  );
  const glowIds = useMemo(() => {
    if (!activeStore) return allGlowIds;
    return new Set(
      (storeFilters.find((f) => f.storeName === activeStore)?.items ?? []).map(
        (i) => i.itemId,
      ),
    );
  }, [activeStore, storeFilters, allGlowIds]);
  // 선택 지점의 품목별 '발주 들어온 수량' 맵 — 지점 필터 시 팔레트가 남은수량 대신 이 수량을 보인다.
  const storeQty = useMemo(() => {
    if (!activeStore) return null;
    const m = new Map<string, number>();
    for (const i of storeFilters.find((f) => f.storeName === activeStore)?.items ?? [])
      m.set(i.itemId, i.qty);
    return m;
  }, [activeStore, storeFilters]);
  // 박스의 품목이 유통기한 임박(≤30일)/만료인지 — itemId로 재고 조회 후 expiryInfo.
  const isExpiryBox = (b: BoxDTO) => {
    if (!b.itemId) return false;
    const info = expiryInfo(itemById.get(b.itemId)?.expiry ?? "");
    return !!info && (info.level === "soon" || info.level === "expired");
  };
  // 품목 남은수량(실시간 우선, 없으면 SSR 값). null = 재고 아님(폼박스 등)
  const qtyOf = (itemId: string | null | undefined): number | null => {
    if (!itemId) return null;
    if (itemId in liveQty) return liveQty[itemId];
    return itemById.get(itemId)?.qty ?? null;
  };
  const isExpirySoonItem = (it: Item) => {
    const info = expiryInfo(it.expiry);
    return !!info && (info.level === "soon" || info.level === "expired");
  };

  const active = useRef<Active | null>(null);
  const boxesRef = useRef(boxes);
  boxesRef.current = boxes;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;
  const canvasElRef = useRef<HTMLDivElement | null>(null); // 평면도 DOM(마퀴 좌표 계산)
  const marqStart = useRef<{ x0: number; y0: number } | null>(null); // 마퀴 시작점(캔버스 좌표)
  const marqRect = useRef<{ x: number; y: number; w: number; h: number } | null>(null); // 마퀴 현재 사각형
  const preGesture = useRef<BoxDTO[]>([]); // 제스처 시작 시 전체 박스 스냅샷(밀려난 박스까지 저장 diff용)
  const liveBoxes = useRef<BoxDTO[]>([]); // 제스처 중 동기 작업본(React 플러시 타이밍과 무관하게 최신 유지)
  const locationRef = useRef(location); // 현재 장소(전역 리스너에서 최신값 참조)
  locationRef.current = location;

  // 위치 전환 — 해당 위치 박스 로드
  const switchLocation = async (loc: string) => {
    if (loc === location || active.current) return;
    setLocation(loc);
    setSelectedIds([]);
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
      const nb = res.box;
      const before = boxesRef.current;
      // 새 박스가 기존과 겹치면 기존 셀을 밀어낸다(절대 안 겹침).
      const merged = separate([...before, nb], new Set([nb.id]));
      setBoxes(merged);
      setSelectedIds([nb.id]);
      const prev = new Map(before.map((b) => [b.id, b]));
      for (const cur of merged) {
        const o = prev.get(cur.id);
        if (o ? o.x !== cur.x || o.y !== cur.y : cur.x !== nb.x || cur.y !== nb.y) {
          updateBox({ id: cur.id, x: cur.x, y: cur.y }).catch(() => {});
        }
      }
      flashSavedRef.current();
    }
  };

  // #12 폼박스(창문/문/계단 등 구조물) 추가 — 재고 아님. 편집모드를 켜 바로 배치.
  const addForm = async (label: string) => {
    const res = await createBox({
      location,
      itemId: null,
      label,
      x: 60,
      y: 60,
      w: 120,
      h: 60,
      color: "form",
    }).catch(() => null);
    if (res?.ok && res.box) {
      setBoxes((b) => [...b, res.box!]);
      setFormEdit(true);
      setSelectedIds([res.box.id]);
      flashSavedRef.current();
    }
  };

  const removeBox = async (id: string) => {
    setBoxes((b) => b.filter((x) => x.id !== id));
    setSelectedIds((ids) => ids.filter((x) => x !== id));
    await deleteBox(id).catch(() => {});
    flashSavedRef.current();
  };

  // 셀 배경색 변경(우클릭 색 선택). ""=기본색으로 초기화.
  const setBoxColor = async (id: string, color: string) => {
    setBoxes((b) => b.map((x) => (x.id === id ? { ...x, color } : x)));
    await updateBox({ id, color }).catch(() => {});
    flashSavedRef.current();
  };

  const renameBox = async (box: BoxDTO) => {
    const next = window.prompt("이름 변경", box.label)?.trim();
    if (!next || next === box.label) return;
    setBoxes((b) => b.map((x) => (x.id === box.id ? { ...x, label: next } : x)));
    await updateBox({ id: box.id, label: next }).catch(() => {});
    flashSavedRef.current();
  };

  // 여러 개가 선택된 상태에서 그 중 하나를 잡으면 그룹 전체 스냅샷을 만든다(함께 이동/똑같이 리사이즈).
  // 선택 밖의 박스를 잡으면 그 하나만 단일 선택.
  const groupFor = (id: string): BoxDTO[] | undefined => {
    const ids = selectedRef.current;
    if (ids.length > 1 && ids.includes(id)) {
      return boxesRef.current.filter((b) => ids.includes(b.id)).map((b) => ({ ...b }));
    }
    return undefined;
  };
  const snapshotForGesture = () => {
    preGesture.current = boxesRef.current.map((b) => ({ ...b }));
    liveBoxes.current = boxesRef.current.map((b) => ({ ...b }));
  };
  const startDrag = (e: React.PointerEvent, box: BoxDTO) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const group = groupFor(box.id);
    if (!group) setSelectedIds([box.id]);
    snapshotForGesture();
    active.current = { mode: "drag", id: box.id, sx: e.clientX, sy: e.clientY, box: { ...box }, group };
  };
  const startResize = (e: React.PointerEvent, box: BoxDTO, handle: Handle) => {
    e.preventDefault();
    e.stopPropagation();
    const group = groupFor(box.id);
    if (!group) setSelectedIds([box.id]);
    snapshotForGesture();
    active.current = { mode: "resize", id: box.id, handle, sx: e.clientX, sy: e.clientY, box: { ...box }, group };
  };

  // 전역 포인터 이동/해제 — 마퀴(드래그 선택) + 박스 드래그·리사이즈(단일/그룹) + 스냅
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      // 1) 드래그 선택(마퀴) 진행 중 — 캔버스 좌표로 사각형 갱신
      if (marqStart.current) {
        const el = canvasElRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const cw = canvasRef.current.w,
            ch = canvasRef.current.h;
          const cx = Math.max(0, Math.min(cw, e.clientX - rect.left));
          const cy = Math.max(0, Math.min(ch, e.clientY - rect.top));
          const { x0, y0 } = marqStart.current;
          const r = {
            x: Math.min(x0, cx),
            y: Math.min(y0, cy),
            w: Math.abs(cx - x0),
            h: Math.abs(cy - y0),
          };
          marqRect.current = r;
          setMarquee(r);
        }
        return;
      }
      const a = active.current;
      if (!a) return;
      const cv = canvasRef.current;
      // 지오메트리 변경 적용 → 겹침 밀어내기(separate) → 밀려나 캔버스 밖이면 평면도 자동확장.
      const commit = (mapFn: (b: BoxDTO) => BoxDTO, activeIds: Set<string>) => {
        const sep = separate(liveBoxes.current.map(mapFn), activeIds);
        liveBoxes.current = sep;
        setBoxes(sep);
        let needW = 0,
          needH = 0;
        for (const b of sep) {
          needW = Math.max(needW, b.x + b.w);
          needH = Math.max(needH, b.y + b.h);
        }
        const c = canvasRef.current;
        if (needW > c.w || needH > c.h) {
          setCanvas({
            w: Math.max(c.w, Math.ceil(needW) + 40),
            h: Math.max(c.h, Math.ceil(needH) + 40),
          });
        }
      };
      if (a.mode === "drag") {
        const dx = e.clientX - a.sx,
          dy = e.clientY - a.sy;
        if (a.group && a.group.length > 1) {
          // 그룹 전체를 같은 델타로 함께 이동(스냅 없음) — 겹치면 다른 셀을 밀어낸다.
          const g = a.group;
          commit(
            (b) => {
              const o = g.find((x) => x.id === b.id);
              return o ? { ...b, x: Math.max(0, o.x + dx), y: Math.max(0, o.y + dy) } : b;
            },
            new Set(g.map((x) => x.id)),
          );
          setGuides({ v: [], h: [] });
        } else {
          const others: Rect[] = liveBoxes.current
            .filter((b) => b.id !== a.id)
            .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
          const s = snapDrag(
            { x: a.box.x + dx, y: a.box.y + dy, w: a.box.w, h: a.box.h },
            others,
            cv.w,
            cv.h,
          );
          commit(
            (b) => (b.id === a.id ? { ...b, x: Math.max(0, s.x), y: Math.max(0, s.y) } : b),
            new Set([a.id]),
          );
          setGuides({ v: s.v, h: s.h });
        }
      } else {
        const others: Rect[] = liveBoxes.current
          .filter((b) => b.id !== a.id)
          .map((b) => ({ x: b.x, y: b.y, w: b.w, h: b.h }));
        const r = snapResize(a.handle, a.box, e.clientX - a.sx, e.clientY - a.sy, others, cv.w, cv.h);
        if (a.group && a.group.length > 1) {
          // 그룹 전체를 '똑같은 크기'로 키우고, 서로/이웃과 겹치면 밀어낸다(절대 안 겹침).
          const ids = new Set(a.group.map((x) => x.id));
          commit((b) => {
            if (b.id === a.id) return { ...b, x: r.x, y: r.y, w: r.w, h: r.h };
            return ids.has(b.id) ? { ...b, w: r.w, h: r.h } : b;
          }, ids);
          setGuides({ v: r.vg, h: r.hg });
        } else {
          commit((b) => (b.id === a.id ? { ...b, x: r.x, y: r.y, w: r.w, h: r.h } : b), new Set([a.id]));
          setGuides({ v: r.vg, h: r.hg });
        }
      }
    };
    const onUp = () => {
      // 마퀴 종료 → 사각형에 걸린 재고 셀(품목)만 다중 선택
      if (marqStart.current) {
        marqStart.current = null;
        const m = marqRect.current;
        marqRect.current = null;
        setMarquee(null);
        if (m && (m.w > 3 || m.h > 3)) {
          const hit = boxesRef.current
            .filter(
              (b) =>
                b.itemId &&
                b.x < m.x + m.w &&
                b.x + b.w > m.x &&
                b.y < m.y + m.h &&
                b.y + b.h > m.y,
            )
            .map((b) => b.id);
          setSelectedIds(hit);
        } else {
          setSelectedIds([]); // 빈 클릭 = 선택 해제
        }
        return;
      }
      const a = active.current;
      if (!a) return;
      active.current = null;
      setGuides({ v: [], h: [] });
      // 저장 직전 한 번 더 확실히 겹침 정리(제스처 작업본 기준 — 플러시 타이밍과 무관).
      const activeIds = new Set(
        a.group && a.group.length > 1 ? a.group.map((g) => g.id) : [a.id],
      );
      const base = liveBoxes.current.length ? liveBoxes.current : boxesRef.current;
      const finalBoxes = separate(base, activeIds);
      liveBoxes.current = finalBoxes;
      setBoxes(finalBoxes);
      // 밀려나 캔버스 밖이면 평면도 확장(밀려난 셀이 안 잘리게).
      let needW = 0,
        needH = 0;
      for (const b of finalBoxes) {
        needW = Math.max(needW, b.x + b.w);
        needH = Math.max(needH, b.y + b.h);
      }
      const c0 = canvasRef.current;
      const grew = needW > c0.w || needH > c0.h;
      const finalCanvas = grew
        ? { w: Math.max(c0.w, Math.ceil(needW) + 40), h: Math.max(c0.h, Math.ceil(needH) + 40) }
        : c0;
      if (grew) setCanvas(finalCanvas);
      // 방금 옮긴 것 + 밀려난 것 — 시작 스냅샷 대비 바뀐 박스는 모두 저장.
      const before = new Map(preGesture.current.map((b) => [b.id, b]));
      for (const cur of finalBoxes) {
        const o = before.get(cur.id);
        if (o && (o.x !== cur.x || o.y !== cur.y || o.w !== cur.w || o.h !== cur.h)) {
          updateBox({ id: cur.id, x: cur.x, y: cur.y, w: cur.w, h: cur.h }).catch(() => {});
        }
      }
      // 캔버스가 커졌으면 이 장소 크기로 저장.
      if (grew) {
        try {
          localStorage.setItem(canvasKeyFor(locationRef.current), JSON.stringify(finalCanvas));
        } catch {
          /* noop */
        }
      }
      flashSavedRef.current();
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
      if ((e.key === "Delete" || e.key === "Backspace") && selectedRef.current.length) {
        e.preventDefault();
        [...selectedRef.current].forEach((id) => removeBox(id));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const placedItemIds = new Set(boxes.map((b) => b.itemId).filter(Boolean));
  // 미배치 필터용 — 전 장소 스냅샷(placedAllIds) + 현재 장소 실시간 박스의 합집합.
  // (다른 장소는 로드 시점 스냅샷, 현재 장소는 추가/삭제 즉시 반영)
  const placedAnywhere = new Set<string>([
    ...placedAllIds,
    ...(boxes.map((b) => b.itemId).filter(Boolean) as string[]),
  ]);
  const searched = q.trim()
    ? items.filter((it) => it.name.replace(/\s/g, "").includes(q.trim().replace(/\s/g, "")))
    : items;
  // 지점 필터가 켜지면 그 지점 발주 품목만. '미배치' 체크 시 어느 장소에도 없는 품목만.
  const filtered = searched.filter((it) => {
    if (storeQty && !storeQty.has(it.id)) return false;
    if (showUnplaced && placedAnywhere.has(it.id)) return false;
    return true;
  });

  return (
    <div className="whwrap">
      {showIntro && (
        <div className="whintro" onClick={() => setShowIntro(false)}>
          <div className="whintro__card" onClick={(e) => e.stopPropagation()}>
            <div className="whintro__logo">📦 창고관리</div>
            <div className="whintro__count">
              오늘 출고할 발주 <b>{todayCount}</b>건
            </div>
            {storeFilters.length > 0 ? (
              <div className="whintro__stores">
                <div className="whintro__storeshd">
                  오늘 출고하는 지점 · {storeFilters.length}곳
                </div>
                <div className="whintro__storelist">
                  {storeFilters.map((f) => (
                    <span key={f.storeName} className="whintro__store">
                      {f.storeName} <b>{f.items.length}</b>
                    </span>
                  ))}
                </div>
              </div>
            ) : (
              <div className="whintro__none">오늘 출고할 발주가 없어요.</div>
            )}
            <button
              type="button"
              className="whintro__go"
              onClick={() => setShowIntro(false)}
            >
              창고 보기 →
            </button>
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
          {locations.map((l) => (
            <button
              key={l.id}
              type="button"
              className={`whtab ${location === l.id ? "is-on" : ""}`}
              onClick={() => switchLocation(l.id)}
            >
              {l.name}
            </button>
          ))}
          <button
            type="button"
            className={`whtab whtab--edit ${locEdit ? "is-on" : ""}`}
            onClick={() => setLocEdit((v) => !v)}
            title="장소 추가·이름변경·삭제"
          >
            {locEdit ? "완료" : "장소 편집"}
          </button>
        </div>
        <div className="whtop__right">
          <a href="/admin" className="whtop__home" title="관리자 홈으로">
            🏠 홈으로
          </a>
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

      {/* 장소 편집 패널 — 추가/이름변경/삭제(박스 있는 장소는 삭제 불가) */}
      {locEdit && (
        <div className="wllocedit">
          <div className="wllocedit__hd">창고 장소 관리</div>
          {locations.map((l) => (
            <div className="wllocedit__row" key={l.id}>
              <form action={renameLocationAction} className="wllocedit__rename">
                <input type="hidden" name="id" value={l.id} />
                <input
                  className="input"
                  name="name"
                  defaultValue={l.name}
                  maxLength={40}
                />
                <button type="submit" className="btn btn--xs btn--soft">
                  이름변경
                </button>
              </form>
              <form action={deleteLocationAction}>
                <input type="hidden" name="id" value={l.id} />
                <button
                  type="submit"
                  className="btn btn--xs btn--ghost"
                  disabled={l.boxCount > 0 || locations.length <= 1}
                  title={
                    l.boxCount > 0
                      ? "박스가 있는 장소는 삭제할 수 없어요. 먼저 박스를 비워주세요."
                      : locations.length <= 1
                        ? "마지막 장소는 삭제할 수 없어요."
                        : "장소 삭제"
                  }
                >
                  삭제{l.boxCount > 0 ? ` (박스 ${l.boxCount})` : ""}
                </button>
              </form>
            </div>
          ))}
          <form action={addLocationAction} className="wllocedit__add">
            <input
              className="input"
              name="name"
              placeholder="새 장소 이름 (예: 2층 창고)"
              maxLength={40}
            />
            <button type="submit" className="btn btn--xs btn--primary">
              ＋ 장소 추가
            </button>
          </form>
        </div>
      )}

      {/* 지점 필터 — 오늘 나갈 발주(담기·예약연동)가 있는 지점만. 누르면 그 지점 품목만 반짝. */}
      {storeFilters.length > 0 && (
        <div className="whfilter">
          <span className="whfilter__hd">오늘 출고 지점</span>
          <div className="whfilter__btns">
            <button
              type="button"
              className={`whfilter__btn ${activeStore === null ? "is-on" : ""}`}
              onClick={() => setActiveStore(null)}
            >
              전체 <b>{storeFilters.length}</b>
            </button>
            {storeFilters.map((f) => (
              <button
                key={f.storeName}
                type="button"
                className={`whfilter__btn ${activeStore === f.storeName ? "is-on" : ""}`}
                onClick={() =>
                  setActiveStore((s) => (s === f.storeName ? null : f.storeName))
                }
              >
                {f.storeName} <b>{f.items.length}</b>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="whmain">
        <aside className="whside">
          <div className="whside__head">재고 품목</div>
          <input
            className="whside__search"
            placeholder="품목 검색…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="whside__unplaced" title="전 장소(모든 위치) 중 어디에도 배치되지 않은 품목만 보기">
            <input
              type="checkbox"
              checked={showUnplaced}
              onChange={(e) => setShowUnplaced(e.target.checked)}
            />
            <span>미배치만 보기</span>
          </label>
          <div className="whpal">
            {filtered.length === 0 && <div className="whpal__empty">품목이 없어요.</div>}
            {filtered.map((it) => {
              // 지점 필터 시 = 그 지점 '발주 들어온 수량', 전체 시 = 남은수량(실시간).
              const ordered = storeQty ? storeQty.get(it.id) ?? 0 : null;
              const qv = ordered != null ? ordered : qtyOf(it.id) ?? it.qty;
              const soldOut = ordered == null && qv <= 0; // 발주수량 모드에선 품절 표시 안 함
              const expSoon = expiryOn && isExpirySoonItem(it);
              return (
                <button
                  key={it.id}
                  type="button"
                  className={`whpal__item${expSoon ? " whpal__item--exp" : ""}`}
                  onClick={() => addItem(it)}
                >
                  <span className="whpal__name">
                    {expSoon && <span className="whpal__expbadge">⏳</span>}
                    {it.name}
                  </span>
                  <span className="whpal__meta">
                    {placedItemIds.has(it.id) && <span className="whpal__placed">배치됨</span>}
                    <span className={`whpal__qty${soldOut ? " is-out" : ""}`}>
                      {soldOut ? "품절" : `${qv}개`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="whforms">
            <div className="whforms__hd">
              <span>구조물(폼박스)</span>
              <button
                type="button"
                className={`whforms__edit ${formEdit ? "is-on" : ""}`}
                onClick={() => setFormEdit((v) => !v)}
                title="켜면 폼박스를 옮기고 지울 수 있어요. 끄면 클릭 안 돼 배경으로 고정돼요."
              >
                {formEdit ? "편집 중" : "편집"}
              </button>
            </div>
            <div className="whforms__btns">
              {["창문", "문", "계단", "벽"].map((f) => (
                <button
                  key={f}
                  type="button"
                  className="whforms__add"
                  onClick={() => addForm(f)}
                >
                  ＋ {f}
                </button>
              ))}
            </div>
          </div>

        </aside>

        <div
          className="whcanvaswrap"
          onPointerDown={(e) => {
            // 빈 곳(박스/리사이즈 핸들 제외)에서 시작하면 드래그 선택(마퀴) 시작 — 안이든 밖이든.
            const t = e.target as HTMLElement;
            if (t.closest(".whbox") || t.closest(".whcanvas__resize")) return;
            const el = canvasElRef.current;
            if (!el) return;
            e.preventDefault();
            const rect = el.getBoundingClientRect();
            const cw = canvasRef.current.w,
              ch = canvasRef.current.h;
            const x0 = Math.max(0, Math.min(cw, e.clientX - rect.left));
            const y0 = Math.max(0, Math.min(ch, e.clientY - rect.top));
            marqStart.current = { x0, y0 };
            marqRect.current = { x: x0, y: y0, w: 0, h: 0 };
            setMarquee({ x: x0, y: y0, w: 0, h: 0 });
          }}
        >
          <div
            className="whcanvas"
            ref={canvasElRef}
            style={{ width: canvas.w, height: canvas.h }}
          >
            {/* 드래그 선택 사각형(마퀴) */}
            {marquee && (
              <div
                className="whmarquee"
                style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
              />
            )}
            {/* 스냅 가이드선 */}
            {guides.v.map((x, i) => (
              <div key={`v${i}`} className="whguide whguide--v" style={{ left: x }} />
            ))}
            {guides.h.map((y, i) => (
              <div key={`h${i}`} className="whguide whguide--h" style={{ top: y }} />
            ))}

            {boxes.map((b) => {
              const sel = selectedIds.includes(b.id);
              const isForm = !b.itemId; // 폼박스(구조물)=재고 품목 없는 박스. color는 배경색 용도로 자유롭게 씀.
              const custom = /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : null; // 우클릭 지정 배경색
              const today = !isForm && !!b.itemId && glowIds.has(b.itemId); // 오늘 나갈 품목 → 반짝
              const expSoon = !isForm && expiryOn && isExpiryBox(b); // 유통기한 임박 토글 ON + 임박
              // 흐리게(필터 효과): 유통기한 모드면 임박 아닌 것 / 특정 지점 필터면 그 지점 품목 아닌 것.
              const dim =
                !isForm &&
                (expiryOn ? !expSoon : activeStore != null ? !today : false);
              const qv = qtyOf(b.itemId); // 남은수량(재고 박스만)
              // 폼박스는 편집모드 아니면 클릭 안 됨(배경 고정). z: 폼박스는 뒤, 재고는 앞, 호버/선택은 최상.
              const clickable = !isForm || formEdit;
              let zi = isForm ? b.z : 1000 + b.z;
              if (today || expSoon) zi = 1500 + b.z;
              if (hovered === b.id) zi = 2000;
              if (sel) zi = 3000;
              return (
                <div
                  key={b.id}
                  className={`whbox ${isForm ? "whbox--form" : ""} ${sel ? "whbox--sel" : ""} ${today ? "whbox--today" : ""} ${expSoon ? "whbox--expiry" : ""} ${dim ? "whbox--dim" : ""} ${qv != null && qv <= 0 ? "whbox--out" : ""}`}
                  style={{
                    left: b.x,
                    top: b.y,
                    width: b.w,
                    height: b.h,
                    zIndex: zi,
                    pointerEvents: clickable ? "auto" : "none",
                    ...(custom ? { background: custom } : {}),
                  }}
                  onPointerDown={(e) => clickable && startDrag(e, b)}
                  onDoubleClick={() => clickable && renameBox(b)}
                  onContextMenu={(e) => {
                    if (!clickable) return;
                    e.preventDefault();
                    // 다중 선택 중 하나를 우클릭하면 선택 유지(색을 전체 적용), 아니면 그 박스만 선택.
                    if (!(selectedIds.includes(b.id) && selectedIds.length > 1))
                      setSelectedIds([b.id]);
                    setMenu({ id: b.id, x: e.clientX, y: e.clientY });
                  }}
                  onPointerEnter={() => !isForm && setHovered(b.id)}
                  onPointerLeave={() => setHovered((h) => (h === b.id ? null : h))}
                >
                  <span className="whbox__label">{b.label}</span>
                  {!isForm && qv != null && (
                    <span className={`whbox__qty${qv <= 0 ? " is-out" : ""}`}>
                      {qv <= 0 ? "(품절)" : `(${qv}개)`}
                    </span>
                  )}
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

            {/* #12 평면도 자유 리사이즈 — 우하단 핸들 드래그 */}
            <div
              className="whcanvas__resize"
              title="드래그해서 평면도 크기 조절"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const el = e.currentTarget;
                el.setPointerCapture(e.pointerId);
                const sx = e.clientX;
                const sy = e.clientY;
                const sw = canvasRef.current.w;
                const sh = canvasRef.current.h;
                const move = (ev: PointerEvent) => {
                  setCanvas({
                    w: Math.max(600, Math.round(sw + (ev.clientX - sx))),
                    h: Math.max(400, Math.round(sh + (ev.clientY - sy))),
                  });
                };
                const up = () => {
                  el.removeEventListener("pointermove", move);
                  el.removeEventListener("pointerup", up);
                  try {
                    // 이 장소(위치)의 평면도 크기만 저장 — 다른 장소는 영향 없음.
                    localStorage.setItem(canvasKeyFor(location), JSON.stringify(canvasRef.current));
                  } catch {
                    /* noop */
                  }
                };
                el.addEventListener("pointermove", move);
                el.addEventListener("pointerup", up);
              }}
            />
          </div>
          {loading && <div className="whloading">불러오는 중…</div>}
        </div>
      </div>

      {/* 우클릭 컨텍스트 메뉴 — 삭제/이름변경 */}
      {menu && (
        <>
          <div
            className="whmenu__scrim"
            onPointerDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenu(null);
            }}
          />
          <div className="whmenu" style={{ left: menu.x, top: menu.y }}>
            {/* 셀 배경색 — 6색 + 기본색 초기화. 다중 선택 중이면 선택된 셀 전체에 적용. */}
            <div className="whmenu__colors">
              {BOX_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="whmenu__color"
                  style={{ background: c }}
                  title="이 색으로"
                  onClick={() => {
                    const targets =
                      selectedIds.includes(menu.id) && selectedIds.length > 1
                        ? selectedIds
                        : [menu.id];
                    setMenu(null);
                    targets.forEach((id) => setBoxColor(id, c));
                  }}
                />
              ))}
              <button
                type="button"
                className="whmenu__color whmenu__color--reset"
                title="기본색으로"
                onClick={() => {
                  const targets =
                    selectedIds.includes(menu.id) && selectedIds.length > 1
                      ? selectedIds
                      : [menu.id];
                  setMenu(null);
                  targets.forEach((id) => setBoxColor(id, ""));
                }}
              >
                ✕
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                const b = boxesRef.current.find((x) => x.id === menu.id);
                setMenu(null);
                if (b) renameBox(b);
              }}
            >
              이름 변경
            </button>
            <button
              type="button"
              className="whmenu__del"
              onClick={() => {
                const id = menu.id;
                setMenu(null);
                removeBox(id);
              }}
            >
              삭제
            </button>
          </div>
        </>
      )}

      {/* 자동 저장 표시 */}
      <div className={`whsave${saved ? " is-on" : ""}`} aria-live="polite">
        ✓ 자동 저장됨
      </div>
    </div>
  );
}
