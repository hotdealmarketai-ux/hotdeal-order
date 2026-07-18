"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  saveReservationBatchAction,
  deleteReservationBatchAction,
  type ReservationBatchState,
} from "@/app/actions/reservation";
import { SubmitButton } from "./SubmitButton";
import {
  daysBetween,
  reservationDeadlineLabel,
  reservationLoadDate,
} from "@/lib/reservation";
import { labelDate } from "@/lib/date";
import type { ReservationBatchDetail } from "@/lib/reservation-data";

type Row = { key: string; id: string | null; name: string; supplyPrice: string; deleted: boolean };

export function ReservationBatchEditor({ batch }: { batch?: ReservationBatchDetail | null }) {
  const uid = useRef(0);
  const [reserveDate, setReserveDate] = useState(batch?.reserveDate ?? "");
  const [pickupDate, setPickupDate] = useState(batch?.pickupDate ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (batch?.products ?? []).map((p) => ({
      key: `k${uid.current++}`,
      id: p.id,
      name: p.name,
      supplyPrice: String(p.supplyPrice),
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
      { key: `k${uid.current++}`, id: null, name: "", supplyPrice: "0", deleted: false },
    ]);
  }

  const shown = rows.filter((r) => !r.deleted);
  const payload = useMemo(
    () => ({
      batchId: batch?.id ?? null,
      reserveDate,
      pickupDate,
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        supplyPrice: r.supplyPrice,
        deleted: r.deleted,
      })),
    }),
    [batch?.id, reserveDate, pickupDate, rows],
  );

  // 날짜 안내/검증(클라이언트) — 픽업 ≥ 예약 + 2
  const datesValid = /^\d{4}-\d{2}-\d{2}$/.test(reserveDate) && /^\d{4}-\d{2}-\d{2}$/.test(pickupDate);
  const gap = datesValid ? daysBetween(pickupDate, reserveDate) : null;
  const dateWarn = gap !== null && gap < 2 ? "픽업일자는 예약일자보다 2일 이상 뒤여야 해요." : "";

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
        <div className="resv-dates">
          <label className="resv-dates__field">
            <span>예약일자</span>
            <input
              className="input"
              type="date"
              value={reserveDate}
              onChange={(e) => setReserveDate(e.target.value)}
              disabled={datesLocked}
              required
            />
          </label>
          <label className="resv-dates__field">
            <span>픽업일자</span>
            <input
              className="input"
              type="date"
              value={pickupDate}
              onChange={(e) => setPickupDate(e.target.value)}
              disabled={datesLocked}
              required
            />
          </label>
        </div>
        {datesLocked && (
          <div className="resv-note">예약이 접수되어 날짜는 고정됐어요. 상품만 수정할 수 있어요.</div>
        )}
        {dateWarn && <div className="resv-note resv-note--warn">{dateWarn}</div>}
        {datesValid && !dateWarn && (
          <div className="resv-note">
            예약 마감 <b>{reservationDeadlineLabel(reserveDate)}</b> · 공구 자동반영{" "}
            <b>{labelDate(reservationLoadDate(pickupDate))}</b>
          </div>
        )}
      </div>

      <div className="itemshead">
        <span className="itemshead__label">상품 (이름 · 점주공급가)</span>
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
