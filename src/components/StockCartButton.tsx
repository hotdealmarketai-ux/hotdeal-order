"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { holdStockAction } from "@/app/actions/stock";
import { Sheet } from "./Sheet";

const won = (n: number) => n.toLocaleString("ko-KR");

// 재고현황 '담기' — 서버 담기원장(StockHold)에 실시간 반영. 담는 순간 −, 빼면 +.
// available=실시간 남은수량(전체 담기 반영), mine=내가 담은 수량. 내가 담을 수 있는 최대=available+mine.
export function StockCartButton({
  itemId,
  name,
  disabled,
  available,
  mine,
  supplyPrice,
}: {
  itemId: string;
  name: string;
  disabled: boolean;
  available: number;
  mine: number;
  supplyPrice: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(1);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const maxForMe = available + mine; // 내가 담을 수 있는 최대(남은 + 내가 이미 담은 것)
  const soldOut = maxForMe <= 0;

  if (disabled || (soldOut && mine <= 0)) {
    return (
      <span className="badge badge--mute" style={{ opacity: 0.6, flexShrink: 0 }}>
        {soldOut ? "품절" : "담기"}
      </span>
    );
  }

  const openSheet = () => {
    setCount(Math.min(Math.max(1, mine || 1), Math.max(1, maxForMe)));
    setErr("");
    setOpen(true);
  };
  const dec = () => setCount((c) => Math.max(1, c - 1));
  const inc = () => setCount((c) => Math.min(maxForMe, c + 1));

  const apply = (qty: number) =>
    start(async () => {
      const res = await holdStockAction({ itemId, qty });
      if (!res.ok) {
        setErr(res.error ?? "담기에 실패했어요.");
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      <button
        type="button"
        className={`btn btn--xs ${mine > 0 ? "btn--soft" : "btn--primary"}`}
        style={{ flexShrink: 0 }}
        onClick={openSheet}
      >
        {mine > 0 ? `담음 ${mine}개` : "담기"}
      </button>

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel stocksheet" style={{ maxWidth: 480 }}>
            <div className="stocksheet__grip" aria-hidden="true" />
            <div className="stockrow">
              <div className="stockrow__thumb">
                <span className="stockrow__thumb-k">남은 수량</span>
                <span className="stockrow__thumb-v">{available}개</span>
              </div>
              <div className="stockrow__info">
                <div className="stockrow__name">{name}</div>
                {supplyPrice > 0 && (
                  <div className="stockrow__price">{won(supplyPrice)}원</div>
                )}
              </div>
              <div className="stepper" role="group" aria-label="수량">
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label="감소"
                  onClick={dec}
                  disabled={count <= 1 || pending}
                >
                  −
                </button>
                <span className="stepper__val">{count}</span>
                <button
                  type="button"
                  className="stepper__btn"
                  aria-label="증가"
                  onClick={inc}
                  disabled={count >= maxForMe || pending}
                >
                  +
                </button>
              </div>
            </div>

            {err && <div className="chaterr">{err}</div>}

            <button
              type="button"
              className="btn btn--primary btn--block stocksheet__add"
              onClick={() => apply(count)}
              disabled={pending}
            >
              {pending ? "처리 중…" : mine > 0 ? "수량 변경" : "담기"}
            </button>
            {mine > 0 && (
              <button
                type="button"
                className="linkbtn linkbtn--danger"
                style={{ display: "block", margin: "10px auto 0" }}
                onClick={() => apply(0)}
                disabled={pending}
              >
                담기 빼기
              </button>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
