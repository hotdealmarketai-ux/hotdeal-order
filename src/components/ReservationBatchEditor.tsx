"use client";

import { useActionState, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  saveReservationBatchAction,
  deleteReservationBatchAction,
  type ReservationBatchState,
} from "@/app/actions/reservation";
import { SubmitButton } from "./SubmitButton";
import { Sheet } from "./Sheet";
import { MoneyInput } from "./MoneyInput";
import { daysBetween, reservationDeadlineLabel } from "@/lib/reservation";
import type { ReservationBatchDetail } from "@/lib/reservation-data";

const won = (n: number) => n.toLocaleString("ko-KR");

type Row = {
  key: string;
  id: string | null;
  name: string;
  supplyPrice: string;
  pickupDate: string; // 상품별 픽업일자
  inventoryItemId: string; // "" = 수기, 값 = 재고현황 연동
  deleted: boolean;
};

export type InventoryPick = { id: string; name: string; supplyPrice: number };

export function ReservationBatchEditor({
  batch,
  inventoryItems = [],
}: {
  batch?: ReservationBatchDetail | null;
  inventoryItems?: InventoryPick[];
}) {
  const uid = useRef(0);
  const [reserveDate, setReserveDate] = useState(batch?.reserveDate ?? "");
  const [rows, setRows] = useState<Row[]>(() =>
    (batch?.products ?? []).map((p) => ({
      key: `k${uid.current++}`,
      id: p.id,
      name: p.name,
      supplyPrice: String(p.supplyPrice),
      pickupDate: p.pickupDate ?? "",
      inventoryItemId: p.inventoryItemId ?? "",
      deleted: false,
    })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
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
      { key: `k${uid.current++}`, id: null, name: "", supplyPrice: "0", pickupDate: "", inventoryItemId: "", deleted: false },
    ]);
  }
  // 재고현황에서 불러오기 — 연동 상품 행 추가(이름 고정, 공급가 프리필)
  function addFromInventory(item: InventoryPick) {
    setRows((prev) => [
      ...prev,
      {
        key: `k${uid.current++}`,
        id: null,
        name: item.name,
        supplyPrice: String(item.supplyPrice ?? 0),
        pickupDate: "",
        inventoryItemId: item.id,
        deleted: false,
      },
    ]);
  }

  const shown = rows.filter((r) => !r.deleted);
  // 이미 담긴(살아있는) 연동 품목 id — 피커에서 중복 제외
  const addedIds = new Set(shown.map((r) => r.inventoryItemId).filter(Boolean));
  const pickList = inventoryItems.filter(
    (it) =>
      !addedIds.has(it.id) &&
      (!pickQ.trim() || it.name.toLowerCase().includes(pickQ.trim().toLowerCase())),
  );

  const payload = useMemo(
    () => ({
      batchId: batch?.id ?? null,
      reserveDate,
      products: rows.map((r) => ({
        id: r.id,
        name: r.name,
        supplyPrice: r.supplyPrice,
        pickupDate: r.pickupDate,
        inventoryItemId: r.inventoryItemId,
        deleted: r.deleted,
      })),
    }),
    [batch?.id, reserveDate, rows],
  );

  const reserveValid = /^\d{4}-\d{2}-\d{2}$/.test(reserveDate);
  const rowPickupInvalid = (pk: string) =>
    reserveValid && /^\d{4}-\d{2}-\d{2}$/.test(pk) && daysBetween(pk, reserveDate) < 1;
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
        {reserveValid && (
          <div className="resv-note">
            예약 마감 <b>{reservationDeadlineLabel(reserveDate)}</b>
          </div>
        )}
        {anyBadPickup && (
          <div className="resv-note resv-note--warn">
            픽업일이 비었거나 예약일보다 뒤가 아닌 상품이 있어요. 확인해 주세요.
          </div>
        )}
      </div>

      <div className="itemshead">
        <span className="itemshead__label">상품 (이름 · 픽업일 · 점주공급가)</span>
        <span className="itemshead__count">{shown.length}개</span>
      </div>

      {shown.map((r) => {
        const linked = !!r.inventoryItemId;
        return (
          <div className="wprow" key={r.key}>
            {linked ? (
              <div className="wprow__name wprow__name--linked">
                <span className="wprow__linkedname">{r.name}</span>
                <span className="badge badge--ai wprow__linktag">재고연동</span>
              </div>
            ) : (
              <input
                className="input wprow__name"
                value={r.name}
                onChange={(e) => update(r.key, "name", e.target.value)}
                placeholder="상품명"
              />
            )}
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
                <MoneyInput
                  value={r.supplyPrice}
                  onChange={(raw) => update(r.key, "supplyPrice", raw)}
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
        );
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn--soft"
          onClick={addRow}
          style={{ flex: 1 }}
        >
          + 상품 추가
        </button>
        <button
          type="button"
          className="btn btn--soft"
          onClick={() => {
            setPickQ("");
            setPickerOpen(true);
          }}
          style={{ flex: 1 }}
        >
          재고현황에서 불러오기
        </button>
      </div>

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

      {pickerOpen && (
        <Sheet onClose={() => setPickerOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 480 }}>
            <div className="stocksheet__grip" aria-hidden="true" />
            <div className="catsheet__title">재고현황에서 불러오기</div>
            <input
              className="input"
              placeholder="품목명 검색"
              value={pickQ}
              onChange={(e) => setPickQ(e.target.value)}
              style={{ margin: "8px 0 10px" }}
            />
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {pickList.length === 0 ? (
                <div className="empty" style={{ padding: "24px 0" }}>
                  <p>{inventoryItems.length === 0 ? "등록된 재고가 없어요." : "불러올 품목이 없어요."}</p>
                </div>
              ) : (
                pickList.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    className="pickrow"
                    onClick={() => addFromInventory(it)}
                  >
                    <span className="pickrow__name">{it.name}</span>
                    <span className="pickrow__price">
                      {it.supplyPrice > 0 ? `${won(it.supplyPrice)}원` : ""}
                      <span className="pickrow__add">담기 +</span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <div className="confirm__actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="btn btn--primary btn--block"
                onClick={() => setPickerOpen(false)}
              >
                완료 ({addedIds.size}개 연동)
              </button>
            </div>
          </div>
        </Sheet>
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
