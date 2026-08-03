"use client";

import { useState } from "react";
import { Sheet } from "./Sheet";

// 관리자 홈 '마감' 카드 — 전체 핵심 데이터(지점별 미수·발행 계산서·재고현황)를 엑셀로 백업 다운로드.
// 확인은 Sheet(body 포탈)로 — .admcard:active transform 에 갇히지 않게.
export function ClosingCard() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const close = () => {
    if (busy) return;
    setOpen(false);
    setErr("");
    setDone(false);
  };

  const run = async () => {
    setBusy(true);
    setErr("");
    try {
      const res = await fetch("/api/admin/closing", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition") ?? "";
      const m = cd.match(/filename="?([^"]+)"?/);
      // 서버는 ASCII(magam-날짜시간)로 주고, 다운로드 파일명은 한글 '마감-…'으로.
      const name = (m?.[1] ?? "magam.xlsx").replace(/^magam/, "마감");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 즉시 revoke하면 일부 브라우저(구형 Safari/Firefox)에서 다운로드가 취소될 수 있어 지연.
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      setDone(true);
    } catch {
      setErr("백업 생성에 실패했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="admcard"
        style={{ font: "inherit", cursor: "pointer", width: "100%" }}
        onClick={() => setOpen(true)}
      >
        <div className="admcard__title">데이터 백업</div>
      </button>

      {open && (
        <Sheet onClose={close}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">오늘 마감 백업을 만들까요?</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={close}
              >
                ✕
              </button>
            </div>
            {err && (
              <div className="notice notice--error" style={{ marginTop: 8 }}>
                {err}
              </div>
            )}
            {done && (
              <div className="notice notice--ok" style={{ marginTop: 8 }}>
                ✓ 백업 파일을 내려받았어요.
              </div>
            )}
            <div className="sheet__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={close}
                disabled={busy}
              >
                {done ? "닫기" : "취소"}
              </button>
              {!done && (
                <button
                  type="button"
                  className="btn btn--primary"
                  style={{ flex: 1 }}
                  onClick={run}
                  disabled={busy}
                >
                  {busy ? "만드는 중…" : "내려받기"}
                </button>
              )}
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
