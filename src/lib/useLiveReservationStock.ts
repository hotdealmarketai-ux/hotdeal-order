"use client";

import { useEffect, useRef, useState } from "react";

// 예약발주 연동 상품 남은수량 실시간 폴링(배치 단위). 일일 useLiveStock와 같은 개념이나
// productId 키로 배치별로 폴링한다. 4초 주기·탭 숨김 시 정지. 담기 직후 refresh()로 즉시 반영.
type NumMap = Record<string, number>;

export function useLiveReservationStock(batchId: string) {
  const [available, setAvailable] = useState<NumMap>({});
  const [mine, setMine] = useState<NumMap>({});
  const [ready, setReady] = useState(false);
  const inflight = useRef(false);
  const pollRef = useRef<() => void>(() => {});

  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (inflight.current) return;
      if (typeof document !== "undefined" && document.hidden) return;
      inflight.current = true;
      try {
        const res = await fetch(
          `/api/reservation/available?batchId=${encodeURIComponent(batchId)}`,
          { cache: "no-store" },
        );
        if (res.ok && !stopped) {
          const j = (await res.json()) as { available?: NumMap; mine?: NumMap };
          setAvailable(j.available ?? {});
          setMine(j.mine ?? {});
          setReady(true);
        }
      } catch {
        /* 순간 오류 무시 — 다음 주기 재시도 */
      } finally {
        inflight.current = false;
      }
    }
    pollRef.current = poll; // 외부에서 refresh() 로 즉시 폴링
    poll();
    const t = setInterval(poll, 4000);
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) poll();
    };
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", onVis);
    return () => {
      stopped = true;
      clearInterval(t);
      if (typeof document !== "undefined")
        document.removeEventListener("visibilitychange", onVis);
    };
  }, [batchId]);

  return {
    ready,
    availableOf: (productId: string, fallback: number) =>
      ready && productId in available ? available[productId] : fallback,
    mineOf: (productId: string, fallback: number) =>
      ready && productId in mine ? mine[productId] : fallback,
    refresh: () => pollRef.current(),
  };
}
