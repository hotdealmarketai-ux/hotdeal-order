"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSetReservationStoreQtyAction } from "@/app/actions/reservation";

export type FlatStoreEdit = {
  userId: string;
  storeName: string;
  itemId: string;
  qty: number;
  inventoryItemId: string;
  stockDeducted: boolean;
  heldUnconfirmed: boolean; // 점주가 담는 중(확정 전) — 본사 수정 잠금
};

// 관리자 상품 상세 — 전 가맹점 점포별 수량 편집(추가/감소/삭제).
// 발주를 안 넣은 지점도 qty 0으로 뜨고, 여기서 수량을 넣으면 그 점주에게도 예약이 생긴다(확정 반영).
// productId 로 저장 — itemId 없이도 신규 생성/삭제 처리. editable=false 면 읽기전용(지난 픽업 마감).
export function FlatProductStoreEditor({
  productId,
  stores,
  editable = true,
}: {
  productId: string;
  stores: FlatStoreEdit[];
  editable?: boolean;
}) {
  const router = useRouter();
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const query = q.trim();
    return query ? stores.filter((s) => s.storeName.includes(query)) : stores;
  }, [q, stores]);
  const orderedCount = stores.filter((s) => s.qty > 0).length;

  const save = (s: FlatStoreEdit, qty: number) => {
    if (qty === s.qty || qty < 0) return;
    setErr("");
    setBusyId(s.userId);
    start(async () => {
      const r = await adminSetReservationStoreQtyAction({ productId, userId: s.userId, qty });
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
        <p>가맹점이 없어요.</p>
      </div>
    );
  }

  return (
    <div className="fpse">
      <input
        className="input"
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="지점 검색"
        style={{ marginBottom: 10 }}
      />
      {!editable && (
        <div className="notice notice--ai" style={{ marginBottom: 10 }}>
          픽업일이 지난 예약이라 수량은 조회만 가능해요.
        </div>
      )}
      {shown.length === 0 ? (
        <div className="empty">
          <p>검색 결과가 없어요.</p>
        </div>
      ) : (
        shown.map((s) => {
          const busy = busyId === s.userId && pending;
          return (
            <div className="fpse__row" key={s.userId}>
              <div className="fpse__store">
                {s.storeName}
                {s.heldUnconfirmed ? (
                  <span className="fpse__none"> · 담는 중(미확정)</span>
                ) : s.qty > 0 ? null : (
                  <span className="fpse__none"> · 발주 없음</span>
                )}
                {s.stockDeducted ? <span className="fpse__out"> · 출고됨</span> : null}
              </div>
              {editable && !s.heldUnconfirmed ? (
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
                  <QtyInput
                    value={s.qty}
                    busy={busy}
                    disabled={pending || s.stockDeducted}
                    onCommit={(n) => save(s, n)}
                  />
                  <button
                    type="button"
                    className="rstep__btn"
                    disabled={pending || s.stockDeducted}
                    onClick={() => save(s, s.qty + 1)}
                    aria-label="더하기"
                  >
                    +
                  </button>
                  {s.qty > 0 && (
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
                  )}
                </div>
              ) : (
                // 읽기전용(지난 픽업 마감) 또는 점주 담는 중 — 확정 수량만 표시.
                <div className="fpse__step">
                  <span className="rstep__val">{s.qty}</span>
                </div>
              )}
            </div>
          );
        })
      )}
      {err && (
        <div className="notice notice--error" style={{ marginTop: 8 }}>
          {err}
        </div>
      )}
      <div className="row__sub" style={{ marginTop: 8 }}>
        발주 지점 {orderedCount}곳 · 전체 가맹점 {stores.length}곳
      </div>
    </div>
  );
}

// 스테퍼 가운데 값 = 직접 입력. 타이핑 중엔 서버 저장 안 하고, 포커스 아웃/Enter 때만 커밋.
function QtyInput({
  value,
  busy,
  disabled,
  onCommit,
}: {
  value: number;
  busy: boolean;
  disabled: boolean;
  onCommit: (n: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  // 저장 후 refresh 등으로 외부 값이 바뀌면 동기화(편집 중엔 사용자가 친 값 유지)
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const digits = draft.replace(/[^0-9]/g, "");
    const n = digits === "" ? 0 : parseInt(digits, 10);
    setDraft(String(n));
    if (n !== value) onCommit(n); // save 쪽에서 동일값/음수는 무시
  };

  return (
    <input
      className="rstep__input"
      type="text"
      inputMode="numeric"
      value={busy ? "…" : draft}
      disabled={disabled}
      onFocus={(e) => {
        setEditing(true);
        e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      aria-label="수량 직접 입력"
    />
  );
}
