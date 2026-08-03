"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminEditReservationItemsAction } from "@/app/actions/reservation";
import type { EditableReservationStore } from "@/lib/reservation-data";

const won = (n: number) => n.toLocaleString("ko-KR");

// 관리자 예약 편집 — 확정한 점주별로 예약 품목 수량을 +/− 하거나 삭제하고 저장.
// 저장하면 점주에게 알림이 가고, 점주는 수정 내역을 볼 수 있다.
export function AdminReservationEditor({
  batchId,
  stores,
}: {
  batchId: string;
  stores: EditableReservationStore[];
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  // pending[itemId] = 편집된 새 수량(0=삭제). 없으면 원본 유지.
  const [pending, setPending] = useState<Record<string, number>>({});
  const [saving, start] = useTransition();
  const [savingUser, setSavingUser] = useState<string | null>(null);
  const [err, setErr] = useState<{ userId: string; msg: string } | null>(null);

  if (stores.length === 0) {
    return <div className="empty">아직 예약한 점주가 없어요.</div>;
  }

  const qtyOf = (itemId: string, original: number) =>
    pending[itemId] ?? original;
  const setQty = (itemId: string, n: number) =>
    setPending((p) => ({ ...p, [itemId]: Math.max(0, n) }));

  const storeChanged = (s: EditableReservationStore) =>
    s.items.some(
      (it) =>
        pending[it.itemId] !== undefined && pending[it.itemId] !== it.qty,
    );

  const save = (s: EditableReservationStore) => {
    const edits = s.items
      .filter(
        (it) =>
          pending[it.itemId] !== undefined && pending[it.itemId] !== it.qty,
      )
      .map((it) => ({ itemId: it.itemId, qty: pending[it.itemId] }));
    if (edits.length === 0) return;
    setErr(null);
    setSavingUser(s.userId);
    start(async () => {
      const res = await adminEditReservationItemsAction({
        batchId,
        userId: s.userId,
        edits,
      });
      setSavingUser(null);
      if (!res.ok) {
        setErr({ userId: s.userId, msg: res.error ?? "저장에 실패했어요." });
        return;
      }
      // 저장한 품목의 pending 정리 후 새로고침(서버 최신값 반영)
      setPending((p) => {
        const next = { ...p };
        for (const e of edits) delete next[e.itemId];
        return next;
      });
      router.refresh();
    });
  };

  // 총 발주 — 전 지점 예약 상품 품목별 취합(편집 중 수량 반영), 많은 순.
  const totalMap = new Map<string, number>();
  let grandQty = 0;
  let grandWon = 0;
  for (const s of stores)
    for (const it of s.items) {
      const q = qtyOf(it.itemId, it.qty);
      grandQty += q;
      grandWon += q * it.supplyPrice;
      if (q > 0) totalMap.set(it.name, (totalMap.get(it.name) ?? 0) + q);
    }
  const totals = [...totalMap.entries()]
    .map(([name, qty]) => ({ name, qty }))
    .sort((a, b) => b.qty - a.qty);
  const totalOpen = openId === "__TOTAL__";

  return (
    <div className="stack">
      {stores.map((s) => {
        const isOpen = openId === s.userId;
        const sQty = s.items.reduce(
          (n, it) => n + qtyOf(it.itemId, it.qty),
          0,
        );
        const sWon = s.items.reduce(
          (n, it) => n + qtyOf(it.itemId, it.qty) * it.supplyPrice,
          0,
        );
        const changed = storeChanged(s);
        return (
          <div key={s.userId} className="confmerch">
            <button
              type="button"
              className="confmerch__head"
              onClick={() => setOpenId(isOpen ? null : s.userId)}
              aria-expanded={isOpen}
            >
              <span className="resv-conf__name">
                {s.storeName}
                {!s.confirmed && (
                  <span className="resvedit__unconfirmed" title="점주가 아직 확정하지 않음 — 수정해도 확정 전엔 공구·계산서에 반영되지 않아요">
                    미확정
                  </span>
                )}
                {changed && <span className="resvedit__dot" aria-label="변경됨" />}
              </span>
              <span className="confmerch__meta">
                {sQty}개 · {won(sWon)}원
                <span className="confmerch__caret" aria-hidden="true">
                  {isOpen ? "▲" : "▼"}
                </span>
              </span>
            </button>
            {isOpen && (
              <div className="confmerch__items">
                {s.items.map((it) => {
                  const q = qtyOf(it.itemId, it.qty);
                  const removed = q <= 0;
                  return (
                    <div
                      className={`resvedit__row${removed ? " is-removed" : ""}`}
                      key={it.itemId}
                    >
                      <span className="resvedit__name">{it.name}</span>
                      {it.stockDeducted ? (
                        <span className="resvedit__locked">출고됨 {it.qty}개</span>
                      ) : (
                        <span className="resvedit__ctrl">
                          <button
                            type="button"
                            className="resvedit__step"
                            onClick={() => setQty(it.itemId, q - 1)}
                            disabled={q <= 0}
                            aria-label="감소"
                          >
                            −
                          </button>
                          <span className="resvedit__qty">{q}</span>
                          <button
                            type="button"
                            className="resvedit__step"
                            onClick={() => setQty(it.itemId, q + 1)}
                            aria-label="증가"
                          >
                            +
                          </button>
                          <button
                            type="button"
                            className="resvedit__del"
                            onClick={() =>
                              setQty(it.itemId, removed ? it.qty : 0)
                            }
                            aria-label={removed ? "되돌리기" : "삭제"}
                            title={removed ? "되돌리기" : "삭제"}
                          >
                            {removed ? "되돌리기" : "✕"}
                          </button>
                        </span>
                      )}
                    </div>
                  );
                })}
                {err?.userId === s.userId && (
                  <div className="notice notice--error" style={{ marginTop: 8 }}>
                    {err.msg}
                  </div>
                )}
                {changed && (
                  <button
                    type="button"
                    className="btn btn--primary btn--block"
                    style={{ marginTop: 10 }}
                    disabled={saving && savingUser === s.userId}
                    onClick={() => save(s)}
                  >
                    {saving && savingUser === s.userId
                      ? "저장 중…"
                      : "이 점포 예약 저장"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* 총 발주 — 전 지점 취합(항상 맨 아래) */}
      <div className="confmerch confmerch--total">
        <button
          type="button"
          className="confmerch__head"
          onClick={() => setOpenId(totalOpen ? null : "__TOTAL__")}
          aria-expanded={totalOpen}
        >
          <span className="resv-conf__name">총 발주</span>
          <span className="confmerch__meta">
            {grandQty}개 · {won(grandWon)}원
            <span className="confmerch__caret" aria-hidden="true">
              {totalOpen ? "▲" : "▼"}
            </span>
          </span>
        </button>
        {totalOpen && (
          <div className="confmerch__items">
            {totals.length === 0 ? (
              <div className="confmerch__item">
                <span className="muted">예약 상품이 없어요.</span>
              </div>
            ) : (
              totals.map((t, i) => (
                <div className="confmerch__item" key={i}>
                  <span>{t.name}</span>
                  <span className="confmerch__itemqty">{t.qty}개</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
