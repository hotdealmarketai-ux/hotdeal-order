"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { adminSetReservationStoreQtyAction } from "@/app/actions/reservation";
import { stepDown, stepUp, type FlatQtyRule } from "@/lib/flat-qty-rule";
import { ConfirmSheet } from "./ConfirmSheet";

export type FlatStoreEdit = {
  userId: string;
  storeName: string;
  itemId: string;
  qty: number; // 확정 수량(출고·계산서와 같음)
  inventoryItemId: string;
  stockDeducted: boolean;
  heldUnconfirmed: boolean; // 점주가 아직 확정 안 한 줄 — 마감 전엔 본사가 못 고치고, 마감 뒤엔 덮어쓴다
  heldQty?: number; // 그 미확정 줄 수량(나가지 않음)
  belowRule?: boolean; // 확정 수량이 지금 규칙(최소·몇 개씩)과 다름 → 빨간 점(막지는 않음)
  statusLabel?: string; // 승인 안 된 지점(정지 등) — 남은 줄을 지우기만 할 수 있다(서버도 0만 받음)
};

// 관리자 공산품 상세 — 전 가맹점 점포별 수량 대신 고치기(추가/감소/삭제).
// 발주를 안 넣은 지점도 qty 0으로 뜨고, 여기서 수량을 넣으면 그 점주에게도 발주가 생긴다(확정 반영).
// productId 로 저장 — itemId 없이도 신규 생성/삭제 처리. editable=false 면 읽기전용(출고 지난 공산품).
// 규칙(최소·몇 개씩)에 안 맞아도 저장하고, 서버가 돌려준 경고를 주황 한 줄로 보여 준다(오류·경고는 고친 줄 바로 밑).
export function FlatProductStoreEditor({
  productId,
  stores,
  editable = true,
  closed = false,
  rule = { minPerStore: null, qtyStep: 1 },
}: {
  productId: string;
  stores: FlatStoreEdit[];
  editable?: boolean;
  closed?: boolean; // 발주 마감 지남 — 점주가 확정 안 한 줄도 본사가 덮어쓸 수 있다
  rule?: FlatQtyRule;
}) {
  const router = useRouter();
  // 저장 결과 — 고친 지점 줄 바로 밑에 그린다(목록이 길어 맨 위에 두면 화면 밖이라 못 본다).
  const [msg, setMsg] = useState<{ userId: string; error?: string; warning?: string } | null>(null);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState("");
  const [askDel, setAskDel] = useState<FlatStoreEdit | null>(null);
  const [pending, start] = useTransition();

  const shown = useMemo(() => {
    const query = q.trim();
    return query ? stores.filter((s) => s.storeName.includes(query)) : stores;
  }, [q, stores]);
  const orderedCount = stores.filter((s) => s.qty > 0).length;
  const approvedCount = stores.filter((s) => !s.statusLabel).length;

  const save = (s: FlatStoreEdit, qty: number) => {
    if (qty < 0 || (qty === s.qty && !s.heldUnconfirmed)) return;
    setMsg(null);
    setBusyId(s.userId);
    start(async () => {
      const r = await adminSetReservationStoreQtyAction({ productId, userId: s.userId, qty });
      setBusyId("");
      if (!r.ok) {
        setMsg({ userId: s.userId, error: r.error ?? "저장에 실패했어요. 다시 시도해 주세요." });
        return;
      }
      if (r.warning) setMsg({ userId: s.userId, warning: r.warning });
      router.refresh();
    });
  };
  // [−]가 0(삭제)이 되면 한 번 묻는다.
  const minus = (s: FlatStoreEdit) => {
    const next = stepDown(s.qty, rule);
    if (next === 0 && s.qty > 0) setAskDel(s);
    else save(s, next);
  };

  if (stores.length === 0) {
    return (
      <div className="empty">
        <p>지점이 없어요.</p>
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
          출고일이 지나 수정할 수 없어요.
        </div>
      )}
      {shown.length === 0 ? (
        <div className="empty">
          <p>검색 결과가 없어요.</p>
        </div>
      ) : (
        shown.map((s) => {
          const busy = busyId === s.userId && pending;
          // 마감 전 미확정 줄은 점주가 고르는 중이라 잠그고, 마감 뒤엔 본사가 덮어쓴다.
          const canEdit = editable && (!s.heldUnconfirmed || closed);
          // 승인 안 된 지점 — 남은 줄을 지우기만(수량을 늘리거나 새로 넣을 수 없다)
          const removeOnly = !!s.statusLabel;
          const m = msg?.userId === s.userId ? msg : null;
          return (
            <Fragment key={s.userId}>
              <div className="fpse__row">
                <div className="fpse__store">
                  {s.belowRule && <span className="fpse__bad" title="수량 확인 필요" aria-label="수량 확인 필요" />}
                  {s.storeName}
                  {s.statusLabel ? <span className="fpse__out"> · {s.statusLabel}</span> : null}
                  {s.heldUnconfirmed ? (
                    <span className="fpse__held"> · 발주 전 {s.heldQty ?? 0}개</span>
                  ) : s.qty > 0 ? null : (
                    <span className="fpse__none"> · 발주 없음</span>
                  )}
                  {s.stockDeducted ? <span className="fpse__out"> · 출고됨</span> : null}
                </div>
                {canEdit && removeOnly ? (
                  <div className="fpse__step">
                    <span className="rstep__val">{s.qty}</span>
                    {(s.qty > 0 || s.heldUnconfirmed) && (
                      <button
                        type="button"
                        className="btn btn--xs btn--ghost"
                        disabled={pending || s.stockDeducted}
                        onClick={() => setAskDel(s)}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ) : canEdit ? (
                  <div className="fpse__step">
                    <button
                      type="button"
                      className="rstep__btn"
                      disabled={pending || s.stockDeducted || s.qty <= 0}
                      onClick={() => minus(s)}
                      aria-label="수량 줄이기"
                    >
                      −
                    </button>
                    <QtyInput
                      value={s.qty}
                      busy={busy}
                      disabled={pending || s.stockDeducted}
                      onCommit={(n) => (n === 0 && s.qty > 0 ? setAskDel(s) : save(s, n))}
                    />
                    <button
                      type="button"
                      className="rstep__btn"
                      disabled={pending || s.stockDeducted}
                      onClick={() => save(s, stepUp(s.qty, rule))}
                      aria-label="수량 늘리기"
                    >
                      +
                    </button>
                    {s.qty > 0 && (
                      <button
                        type="button"
                        className="btn btn--xs btn--ghost"
                        disabled={pending || s.stockDeducted}
                        onClick={() => setAskDel(s)}
                      >
                        삭제
                      </button>
                    )}
                  </div>
                ) : (
                  // 읽기전용(출고 지난 공산품) 또는 마감 전 점주 고르는 중 — 확정 수량만 표시.
                  <div className="fpse__step">
                    <span className="rstep__val">{s.qty}</span>
                  </div>
                )}
              </div>
              {m?.error && (
                <div className="notice notice--error" style={{ margin: "6px 0 8px" }}>
                  {m.error}
                </div>
              )}
              {m?.warning && (
                <div className="gsp-note gsp-note--warn" style={{ margin: "6px 0 8px" }}>
                  {m.warning}
                </div>
              )}
            </Fragment>
          );
        })
      )}
      <div className="row__sub" style={{ marginTop: 8 }}>
        발주 지점 {orderedCount}곳 · 전체 {approvedCount}곳
      </div>

      {askDel && (
        <ConfirmSheet
          title={`${askDel.storeName} 발주를 삭제할까요?`}
          onConfirm={() => save(askDel, 0)}
          onClose={() => setAskDel(null)}
        />
      )}
    </div>
  );
}

// 스테퍼 가운데 값 = 직접 입력. 타이핑 중엔 서버 저장 안 하고, 포커스 아웃/Enter 때만 커밋.
// 타이핑 중 글자만 따로 들고(typing), 아닐 땐 늘 바깥 값(value)을 보여 준다 — 저장 후 새로고침 값이 바로 보인다.
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
  const [typing, setTyping] = useState<string | null>(null);

  const commit = () => {
    if (typing === null) return;
    const n = typing === "" ? 0 : parseInt(typing, 10);
    setTyping(null);
    if (n !== value) onCommit(n); // save 쪽에서 동일값/음수는 무시
  };

  return (
    <input
      className="rstep__input"
      type="text"
      inputMode="numeric"
      value={busy ? "…" : (typing ?? String(value))}
      disabled={disabled}
      onFocus={(e) => {
        setTyping(String(value));
        e.currentTarget.select();
      }}
      onChange={(e) => setTyping(e.target.value.replace(/[^0-9]/g, "").slice(0, 5))}
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
