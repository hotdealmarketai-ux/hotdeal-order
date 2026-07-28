"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { purgeHiddenReservationsAction } from "@/app/actions/reservation";
import { Sheet } from "./Sheet";

// 숨겨진(삭제된) 예약발주 완전삭제 — 같은 예약일자를 다시 못 만드는 문제(유니크 점유) 해소.
// 파괴적이라 확인 1회(Sheet). 숨겨진 게 없으면 노출 안 함.
export function PurgeHiddenReservationsButton({ count }: { count: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  if (count <= 0 && done === null) return null;

  const run = () =>
    start(async () => {
      const res = await purgeHiddenReservationsAction();
      setDone(res.count);
      setOpen(false);
      router.refresh();
    });

  return (
    <>
      {done !== null ? (
        <div className="notice notice--ok" style={{ marginTop: 12 }}>
          숨겨진 예약 {done}개를 완전히 삭제했어요.
        </div>
      ) : (
        <button
          type="button"
          className="linkbtn linkbtn--danger"
          style={{ display: "block", margin: "14px auto 0" }}
          onClick={() => setOpen(true)}
        >
          숨겨진 예약 {count}개 정리
        </button>
      )}

      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel" style={{ maxWidth: 420 }}>
            <div className="stocksheet__grip" aria-hidden="true" />
            <div className="catsheet__title">숨겨진 예약 정리</div>
            <p className="confirm__hint" style={{ marginTop: 8 }}>
              삭제(숨김) 처리된 예약발주 <b>{count}개</b>를 완전히 삭제합니다. 같은
              예약일자를 다시 만들 수 있게 돼요. 되돌릴 수 없어요. 정말 진행할까요?
            </p>
            <div className="confirm__actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={run}
                disabled={pending}
              >
                {pending ? "삭제 중…" : "완전 삭제"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
