"use client";

import { useEffect, useState } from "react";

// 품목 제한 모드 — 편성 품목 남은 수량 실시간 공유(useLiveStock 과 같은 방식).
// 모듈 싱글톤 폴러 1개를 모든 구독 컴포넌트가 공유(중복 요청 없음). 4초 주기, 탭 숨김 시 정지, 구독자 0이면 정지.
// 소스: GET /api/order-plan/available → { windowKey, restricted, items: { [planItemId]: { remaining, maxForMe, mine } } }

export type LivePlanItem = { remaining: number | null; maxForMe: number | null; mine: number };

let items: Record<string, LivePlanItem> = {};
let windowKey = "";
let restricted = true;
let ready = false;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function pollOnce() {
  if (inflight) return;
  if (typeof document !== "undefined" && document.hidden) return;
  inflight = true;
  try {
    const res = await fetch("/api/order-plan/available", { cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as {
        windowKey?: string;
        restricted?: boolean;
        items?: Record<string, LivePlanItem>;
      };
      items = j.items ?? {};
      windowKey = j.windowKey ?? "";
      restricted = j.restricted !== false;
      ready = true;
      subs.forEach((cb) => cb());
    }
  } catch {
    /* 네트워크 순간 오류는 무시 — 다음 주기에 재시도 */
  } finally {
    inflight = false;
  }
}

function onVisible() {
  if (typeof document !== "undefined" && !document.hidden) pollOnce();
}

function start() {
  if (timer) return;
  pollOnce();
  timer = setInterval(pollOnce, 4000);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisible);
  }
}

function stopIfIdle() {
  if (subs.size > 0) return;
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisible);
  }
}

/** 저장 실패(줄별 오류) 직후 등 — 즉시 최신값을 끌어온다. */
export function refreshLivePlan() {
  pollOnce();
}

/** enabled=false 면 구독하지 않는다(제한 모드가 아닌 화면). */
export function useLivePlan(enabled: boolean = true) {
  const [, force] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const cb = () => force((n) => n + 1);
    subs.add(cb);
    start();
    return () => {
      subs.delete(cb);
      stopIfIdle();
    };
  }, [enabled]);
  const on = enabled && ready;
  return {
    ready: on,
    /** 서버가 지금 보는 발주창 키(아직 못 읽었으면 "") */
    windowKey: on ? windowKey : "",
    /** 서버 기준 제한 모드가 이 지점에 적용 중인가(못 읽었으면 true) */
    restricted: on ? restricted : true,
    /** 그 품목의 실시간 값. 아직 못 읽었으면 undefined(화면 값 사용), 목록에 없으면 null(판매 종료·편성에서 빠짐). */
    itemOf: (id: string): LivePlanItem | null | undefined => {
      if (!on) return undefined;
      return id in items ? items[id] : null;
    },
    /** 서버 목록에는 있는데 화면에 없는 품목 수(관리자가 그 사이 추가) */
    unknownCount: (knownIds: Set<string>): number => {
      if (!on) return 0;
      let n = 0;
      for (const id of Object.keys(items)) if (!knownIds.has(id)) n++;
      return n;
    },
  };
}
