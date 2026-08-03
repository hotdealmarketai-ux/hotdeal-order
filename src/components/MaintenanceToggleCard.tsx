"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { setMaintenanceAction } from "@/app/actions/maintenance";

// 관리자 홈 '패치' 카드 — 온오프 토글. ON은 비밀번호(1234) 확인 후 적용, OFF는 즉시.
// ON이면 모든 가맹점 화면이 '업데이트 작업으로 사용 불가' 안내로 잠긴다.
export function MaintenanceToggleCard({ on }: { on: boolean }) {
  const [ask, setAsk] = useState(false); // ON 전환 비밀번호 확인 시트
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();

  const close = () => {
    if (pending) return;
    setAsk(false);
    setPw("");
    setErr("");
  };

  const apply = (turnOn: boolean, password: string) => {
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("on", turnOn ? "true" : "false");
      fd.set("password", password);
      const res = await setMaintenanceAction(fd);
      if (res?.error) {
        setErr(res.error);
        return;
      }
      setAsk(false);
      setPw("");
      router.refresh();
    });
  };

  const onToggle = () => {
    if (pending) return;
    if (on) {
      apply(false, ""); // 끄기 — 즉시(비밀번호 불필요)
    } else {
      setErr("");
      setPw("");
      setAsk(true); // 켜기 — 비밀번호 확인
    }
  };

  return (
    <>
      <div className="admcard patchcard">
        <div style={{ minWidth: 0 }}>
          <div className="admcard__title">패치</div>
        </div>
        <button
          type="button"
          className={`switch ${on ? "is-on" : ""}`}
          onClick={onToggle}
          disabled={pending}
          aria-label="패치(유지보수) 모드"
          aria-pressed={on}
        >
          <span className="switch__knob" />
        </button>
      </div>

      {ask && (
        <Sheet onClose={close}>
          <div className="sheet__panel" style={{ maxWidth: 420 }}>
            <div className="sheet__head">
              <div className="sheet__title">패치 모드를 켤까요?</div>
              <button
                type="button"
                className="sheet__close"
                aria-label="닫기"
                onClick={close}
              >
                ✕
              </button>
            </div>
            <input
              className="input"
              type="password"
              inputMode="numeric"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") apply(true, pw);
              }}
              placeholder="비밀번호"
              autoFocus
            />
            {err && (
              <div className="notice notice--error" style={{ marginTop: 8 }}>
                {err}
              </div>
            )}
            <div className="sheet__foot">
              <button
                type="button"
                className="btn btn--ghost"
                onClick={close}
                disabled={pending}
              >
                취소
              </button>
              <button
                type="button"
                className="btn btn--danger"
                style={{ flex: 1 }}
                onClick={() => apply(true, pw)}
                disabled={pending}
              >
                {pending ? "적용 중…" : "사용 차단"}
              </button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
