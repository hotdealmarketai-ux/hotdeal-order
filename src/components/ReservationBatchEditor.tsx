"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  saveReservationBatchAction,
  deleteReservationBatchAction,
  type ReservationBatchState,
} from "@/app/actions/reservation";
import { SubmitButton } from "./SubmitButton";
import { daysBetween, reservationDeadlineLabel } from "@/lib/reservation";
import type { ReservationBatchDetail } from "@/lib/reservation-data";

type Row = {
  key: string;
  id: string | null;
  name: string;
  supplyPrice: string;
  pickupDate: string; // 상품별 픽업일자
  deleted: boolean;
};

export function ReservationBatchEditor({ batch }: { batch?: ReservationBatchDetail | null }) {
  const uid = useRef(0);
  const [reserveDate, setReserveDate] = useState(batch?.reserveDate ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (batch?.products ?? []).map((p) => ({
      key: `k${uid.current++}`,
      id: p.id,
      name: p.name,
      supplyPrice: String(p.supplyPrice),
      pickupDate: p.pickupDate ?? "",
      deleted: false,
    })),
  );
  const [state, formAction] = useActionState<ReservationBatchState, FormData>(
    saveReservationBatchAction,
    {},
  );

  const datesLocked = !!batch?.hasOrders;

  function update(key: string, field: keyof Row, value: string) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  }
  function remove(key: string) {
    setRows((prev) =>
      prev
        .map((r) => (r.key === key ? { ...r, deleted: true } : r))
        .filter((r) => !(r.deleted && !r.id)),
    );
  }
  function addRow() {
    setRows((prev) => [
      ...prev,
      { key: `k${uid.current++}`, id: null, name: "", supplyPrice: "0", pickupDate: "", deleted: false },
    ]);
  }

  const shown = rows.filter((r) => !r.deleted);
  const payload = useMemo(
    () => ({
      batchId: batch?.id ?? null,
      reserveDate,
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        supplyPrice: r.supplyPrice,
        pickupDate: r.pickupDate,
        deleted: r.deleted,
      })),
    }),
    [batch?.id, reserveDate, rows],
  );

  // 예약일자 검증 + 상품별 픽업 검증(픽업 ≥ 예약 + 2). 한 행이라도 어긋나면 경고.
  const reserveValid = /^\d{4}-\d{2}-\d{2}$/.test(reserveDate);
  const rowPickupInvalid = (pk: string) =>
    reserveValid && /^\d{4}-\d{2}-\d{2}$/.test(pk) && daysBetween(pk, reserveDate) < 2;
  const anyBadPickup = shown.some(
    (r) => r.name.trim() && (!/^\d{4}-\d{2}-\d{2}$/.test(r.pickupDate) || rowPickupInvalid(r.pickupDate)),
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="payload" value={JSON.stringify(payload)} />

      {state?.error && (
        <div className="notice notice--error" style={{ marginBottom: 12 }}>
          {state.error}
        </div>
      )}
      {state?.ok && (
        <div className="notice notice--ok" style={{ marginBottom: 12 }}>
          저장했어요.
        </div>
      )}

      <div className="card" style={{ marginBottom: 14 }}>
        <label className="resv-dates__field">
          <span>예약일자 (마감 기준)</span>
          <input
            className="input"
            type="date"
            value={reserveDate}
            onChange={(e) => setReserveDate(e.target.value)}
            disabled={datesLocked}
            required
          />
        </label>
        {datesLocked && (
          <div className="resv-note">예약이 접수되어 예약일자는 고정됐어요. 상품·픽업일은 수정할 수 있어요.</div>
        )}
        {reserveValid && (
          <div className="resv-note">
            예약 마감 <b>{reservationDeadlineLabel(reserveDate)}</b> · 픽업일은 상품마다 지정해요(예약일 +2일 이상).
          </div>
        )}
        {anyBadPickup && (
          <div className="resv-note resv-note--warn">
            픽업일이 비었거나 예약일 +2일 미만인 상품이 있어요. 확인해 주세요.
          </div>
        )}
      </div>

      <div className="itemshead">
        <span className="itemshead__label">상품 (이름 · 픽업일 · 점주공급가)</span>
        <span className="itemshead__count">{shown.length}개</span>
      </div>

      {shown.map((r) => (
        <div className="wprow" key={r.key}>
          <input
            className="input wprow__name"
            value={r.name}
            onChange={(e) => update(r.key, "name", e.target.value)}
            placeholder="상품명"
          />
          <div className="wprow__nums">
            <span className="wprow__field">
              픽업{" "}
              <input
                className="input"
                type="date"
                value={r.pickupDate}
                onChange={(e) => update(r.key, "pickupDate", e.target.value)}
                style={rowPickupInvalid(r.pickupDate) ? { borderColor: "var(--danger)" } : undefined}
              />
            </span>
            <span className="wprow__field">
              공급가{" "}
              <input
                className="input"
                inputMode="numeric"
                value={r.supplyPrice}
                onChange={(e) => update(r.key, "supplyPrice", e.target.value)}
              />{" "}
              원
            </span>
            <button
              type="button"
              className="linkbtn linkbtn--danger"
              onClick={() => remove(r.key)}
            >
              삭제
            </button>
          </div>
        </div>
      ))}

      <button
        type="button"
        className="btn btn--soft btn--block"
        onClick={addRow}
        style={{ marginTop: 10 }}
      >
        + 상품 추가
      </button>

      <div className="ctabar">
        <SubmitButton className="btn btn--primary btn--block" pendingText="저장 중…">
          저장
        </SubmitButton>
      </div>

      {batch?.id && (
        <div style={{ marginTop: 18, textAlign: "center" }}>
          <Link href="/admin/reservations" className="linkbtn">
            ‹ 목록으로
          </Link>
        </div>
      )}
    </form>
  );
}

// 배치 삭제(숨김) — 편집 페이지 하단 별도 폼
export function ReservationBatchDeleteButton({ batchId }: { batchId: string }) {
  return (
    <form action={deleteReservationBatchAction} style={{ marginTop: 24, textAlign: "center" }}>
      <input type="hidden" name="batchId" value={batchId} />
      <SubmitButton className="linkbtn linkbtn--danger" pendingText="삭제 중…">
        이 예약일자 삭제
      </SubmitButton>
    </form>
  );
}
