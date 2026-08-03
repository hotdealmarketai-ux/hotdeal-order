"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminEditReservationItemsAction } from "@/app/actions/reservation";

export type FlatStoreEdit = {
  userId: string;
  storeName: string;
  itemId: string;
  qty: number;
  inventoryItemId: string;
  stockDeducted: boolean;
};

// 관리자 상품 상세 — 이 상품을 예약한 점포별 수량 편집(추가/감소/삭제). qty=홀드라 저장 즉시 반영.
export function FlatProductStoreEditor({
  batchId,
  stores,
}: {
  batchId: string;
  stores: FlatStoreEdit[];
}) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pending, start] = useTransition();

  const save = (s: FlatStoreEdit, qty: number) => {
    if (qty === s.qty) return;
    setErr("");
    setBusyId(s.itemId);
    start(async () => {
      const r = await adminEditReservationItemsAction({
        batchId,
        userId: s.userId,
        edits: [{ itemId: s.itemId, qty }],
      });
      setBusyId("");
      if (!r.ok) {
        setErr(r.error ?? "수정에 실패했어요.");
        return;
      }
      router.refresh();
    });
  };

  if (stores.length === 0) {
    return (
      <div className="empty">
        <p>아직 이 상품을 예약한 점포가 없어요.</p>
      </div>
    );
  }

  return (
    <div className="fpse">
      {stores.map((s) => (
        <div className="fpse__row" key={s.itemId}>
          <div className="fpse__store">
            {s.storeName}
            {s.stockDeducted ? (
              <span className="fpse__out"> · 출고됨</span>
            ) : null}
          </div>
          <div className="fpse__step">
            <button
              type="button"
              className="rstep__btn"
              disabled={pending || s.stockDeducted || s.qty <= 0}
              onClick={() => save(s, s.qty - 1)}
              aria-label="빼기"
            >
              −
            </button>
            <span className="rstep__val">
              {busyId === s.itemId && pending ? "…" : s.qty}
            </span>
            <button
              type="button"
              className="rstep__btn"
              disabled={pending || s.stockDeducted}
              onClick={() => save(s, s.qty + 1)}
              aria-label="더하기"
            >
              +
            </button>
            <button
              type="button"
              className="btn btn--xs btn--ghost"
              disabled={pending || s.stockDeducted}
              onClick={() => {
                if (confirm(`${s.storeName} 예약을 삭제할까요?`)) save(s, 0);
              }}
            >
              삭제
            </button>
          </div>
        </div>
      ))}
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
    </div>
  );
}
