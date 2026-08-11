"use client";

import { useState, useTransition } from "react";
import { messengerLoginAction } from "@/app/actions/messenger";

// 사내 메신저 2차 로그인 — 본인 이름을 고르고 개인 비밀번호(PIN) 입력.
export function MessengerLogin({ members }: { members: { id: string; name: string }[] }) {
  const [sel, setSel] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    if (!sel || !pin.trim()) return;
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("memberId", sel.id);
      fd.set("pin", pin.trim());
      const r = await messengerLoginAction(fd);
      if (r?.error) setErr(r.error); // 성공 시 서버가 리다이렉트
    });
  };

  if (!sel) {
    return (
      <div className="stack" style={{ gap: 10 }}>
        <div className="section-label">본인을 선택하세요</div>
        <div className="list">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className="row"
              style={{ width: "100%", textAlign: "left", cursor: "pointer" }}
              onClick={() => {
                setSel(m);
                setPin("");
                setErr("");
              }}
            >
              <div className="row__main">
                <div className="row__title">{m.name}</div>
              </div>
              <span className="row__sub">선택 ›</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 12 }}>
      <div className="section-label spread">
        <span>{sel.name} 님</span>
        <button type="button" className="btn btn--xs btn--ghost" onClick={() => setSel(null)}>
          다른 사람
        </button>
      </div>
      <input
        className="input"
        type="password"
        inputMode="numeric"
        autoFocus
        value={pin}
        onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        placeholder="개인 비밀번호"
      />
      {err && <div className="notice notice--error">{err}</div>}
      <button type="button" className="btn btn--primary btn--block" onClick={submit} disabled={pending || !pin.trim()}>
        {pending ? "확인 중…" : "메신저 입장"}
      </button>
    </div>
  );
}
