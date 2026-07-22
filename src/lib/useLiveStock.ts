"use client";

import { useEffect, useState } from "react";

// 남은수량 실시간 공유 — 모듈 싱글톤 폴러 1개를 모든 구독 컴포넌트가 공유(중복 요청 없음).
// 4초 주기, 탭 숨김 시 정지, 구독자 0이면 정지. 담기/빼기 직후엔 refreshLiveStock()로 즉시 반영.

type Map = Record<string, number>;
let available: Map = {};
let mine: Map = {};
let ready = false;
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

async function pollOnce() {
  if (inflight) return;
  if (typeof document !== "undefined" && document.hidden) return;
  inflight = true;
  try {
    const res = await fetch("/api/stock/available", { cache: "no-store" });
    if (res.ok) {
      const j = (await res.json()) as { available?: Map; mine?: Map };
      available = j.available ?? {};
      mine = j.mine ?? {};
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

// 담기/빼기 직후 즉시 최신값을 끌어와 전 화면에 반영
export function refreshLiveStock() {
  pollOnce();
}

export function useLiveStock() {
  const [, force] = useState(0);
  useEffect(() => {
    const cb = () => force((n) => n + 1);
    subs.add(cb);
    start();
    return () => {
      subs.delete(cb);
      stopIfIdle();
    };
  }, []);
  return {
    ready,
    // 폴링값이 아직/없으면 SSR fallback 사용
    availableOf: (itemId: string, fallback: number) =>
      ready && itemId in available ? available[itemId] : fallback,
    mineOf: (itemId: string, fallback: number) =>
      ready && itemId in mine ? mine[itemId] : fallback,
  };
}
