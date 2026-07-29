"use client";

import { useEffect, useRef, useState } from "react";
import type { HoldsOverview, HoldItem, HoldRow } from "@/lib/holds";
import {
  adminSetDailyHoldAction,
  adminSetReservationHoldAction,
} from "@/app/actions/holds-admin";
import { labelDate } from "@/lib/date";

const POLL_MS = 5000;
const COMMIT_DELAY_MS = 350;

export function HoldsBoard({ initial }: { initial: HoldsOverview }) {
  const [data, setData] = useState<HoldsOverview>(initial);
  // 편집 중(낙관적) 수량 — 폴링이 덮어쓰지 못하게 보호. 커밋 완료되면 제거.
  const [edits, setEdits] = useState<Record<string, number>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 품목 표시 순서 — 조정 중엔 얼어붙게(행이 손밑에서 튀지 않게). 잠잠하면 서버정렬(남음 적은 순) 채택.
  const [orderIds, setOrderIds] = useState<string[]>(() =>
    initial.items.map((i) => i.itemId),
  );
  const frozenUntil = useRef(0);

  async function refetch() {
    try {
      const r = await fetch("/api/admin/holds", { cache: "no-store" });
      if (!r.ok) return;
      const json = (await r.json()) as HoldsOverview;
      setData(json);
    } catch {
      /* 네트워크 일시 오류는 다음 폴링에서 회복 */
    }
  }

  // 실시간 폴링
  useEffect(() => {
    const id = setInterval(refetch, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // 표시 순서 재조정 — 조정 직후(쿨다운) 동안은 순서 고정, 그 외엔 서버정렬 채택.
  useEffect(() => {
    const serverOrder = data.items.map((i) => i.itemId);
    setOrderIds((prev) => {
      const present = new Set(serverOrder);
      let next: string[];
      if (Date.now() < frozenUntil.current && prev.length) {
        const kept = prev.filter((id) => present.has(id));
        const keptSet = new Set(kept);
        next = [...kept, ...serverOrder.filter((id) => !keptSet.has(id))];
      } else {
        next = serverOrder;
      }
      return next.length === prev.length && next.every((id, i) => id === prev[i])
        ? prev
        : next;
    });
  }, [data]);

  function qtyOf(row: HoldRow): number {
    return row.key in edits ? edits[row.key] : row.qty;
  }

  function bump(row: HoldRow, delta: number) {
    const key = row.key;
    const cur = key in editsRef.current ? editsRef.current[key] : row.qty;
    const next = Math.max(0, cur + delta);
    if (next === cur) return;
    frozenUntil.current = Date.now() + 4000; // 조정 중 순서 고정(행 튐 방지)
    setEdits((e) => ({ ...e, [key]: next }));
    setErrors((e) => {
      if (!(key in e)) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
    if (timers.current[key]) clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(() => void commit(row, next), COMMIT_DELAY_MS);
  }

  async function commit(row: HoldRow, qty: number) {
    const key = row.key;
    const res =
      row.type === "DAILY"
        ? await adminSetDailyHoldAction({ userId: row.userId, itemId: row.itemId, qty })
        : await adminSetReservationHoldAction({ resvItemId: row.resvItemId ?? "", qty });
    await refetch();
    // 그 사이 사용자가 또 바꿨으면(edit!=커밋값) 유지 — 새 타이머가 처리.
    setEdits((e) => {
      if (e[key] !== qty) return e;
      const n = { ...e };
      delete n[key];
      return n;
    });
    if (!res.ok) {
      setErrors((e) => ({ ...e, [key]: res.error ?? "변경에 실패했어요." }));
      setTimeout(() => {
        setErrors((e) => {
          if (!(key in e)) return e;
          const n = { ...e };
          delete n[key];
          return n;
        });
      }, 4000);
    }
  }

  const byId = new Map(data.items.map((i) => [i.itemId, i]));
  const items = orderIds
    .map((id) => byId.get(id))
    .filter((x): x is HoldItem => !!x);

  return (
    <>
      <div className="holdbar">
        <span className="holdbar__live">
          <span className="holdbar__dot" /> 실시간 자동 갱신
        </span>
        <span className="row__sub">
          {items.length}개 품목 · 총 {data.totalHeld.toLocaleString("ko-KR")}개 ·{" "}
          {data.storeCount}개 점포
        </span>
      </div>

      {items.length === 0 ? (
        <div className="empty">
          <p>지금 담아둔 품목이 없어요.</p>
        </div>
      ) : (
        <div className="stack">
          {items.map((it) => (
            <HoldItemCard
              key={it.itemId}
              item={it}
              qtyOf={qtyOf}
              errors={errors}
              onBump={bump}
            />
          ))}
        </div>
      )}
    </>
  );
}

function HoldItemCard({
  item,
  qtyOf,
  errors,
  onBump,
}: {
  item: HoldItem;
  qtyOf: (row: HoldRow) => number;
  errors: Record<string, string>;
  onBump: (row: HoldRow, delta: number) => void;
}) {
  // 편집 중 값 반영한 실시간 남은수량(관리자가 조정하는 즉시 갱신되게)
  const liveHeld = item.rows.reduce((n, r) => n + qtyOf(r), 0);
  const available = item.base - liveHeld;
  const low = available <= 0;
  const warn = !low && available <= 3;

  return (
    <div className="card holdcard">
      <div className="holdcard__head">
        <b className="holdcard__name">{item.name}</b>
        <span className="holdcard__meta">
          <span>기준 {item.base.toLocaleString("ko-KR")}</span>
          <span>담김 {liveHeld.toLocaleString("ko-KR")}</span>
          <span
            className={`holdcard__left ${low ? "is-out" : warn ? "is-warn" : ""}`}
          >
            남음 {Math.max(0, available).toLocaleString("ko-KR")}
          </span>
        </span>
      </div>

      <div className="holdrows">
        {item.rows.map((r) => (
          <div className="holdrow" key={r.key}>
            <div className="holdrow__who">
              <span className="holdrow__store">{r.storeName}</span>
              <span
                className={`holdrow__tag ${r.type === "RESV" ? "is-resv" : "is-daily"}`}
              >
                {r.type === "RESV" ? "예약연동" : "담기"}
              </span>
              {r.type === "RESV" && r.pickupDate && (
                <span className="holdrow__pick">픽업 {labelDate(r.pickupDate)}</span>
              )}
              {errors[r.key] && (
                <span className="holdrow__err">{errors[r.key]}</span>
              )}
            </div>
            <div className="stepper stepper--inline">
              <button
                type="button"
                className="stepper__btn"
                aria-label="한 개 줄이기"
                onClick={() => onBump(r, -1)}
                disabled={qtyOf(r) <= 0}
              >
                −
              </button>
              <span className="stepper__val">{qtyOf(r)}</span>
              <button
                type="button"
                className="stepper__btn"
                aria-label="한 개 늘리기"
                onClick={() => onBump(r, 1)}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
