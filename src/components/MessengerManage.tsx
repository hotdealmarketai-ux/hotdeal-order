"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMessengerMemberAction,
  resetMessengerPinAction,
  toggleMessengerMemberAction,
  addMessengerChannelAction,
  archiveMessengerChannelAction,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };
type Channel = { id: string; name: string; archived: boolean };

export function MessengerManage({ members, channels }: { members: Member[]; channels: Channel[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mName, setMName] = useState("");
  const [mPin, setMPin] = useState("");
  const [mErr, setMErr] = useState("");
  const [cName, setCName] = useState("");
  const [cErr, setCErr] = useState("");
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [resetPin, setResetPin] = useState("");

  const run = (fn: () => Promise<{ error?: string } | void>, onErr?: (e: string) => void, onOk?: () => void) =>
    start(async () => {
      const r = await fn();
      if (r && r.error) {
        onErr?.(r.error);
        return;
      }
      onOk?.();
      router.refresh();
    });

  const addMember = () => {
    setMErr("");
    const fd = new FormData();
    fd.set("name", mName.trim());
    fd.set("pin", mPin.trim());
    run(() => addMessengerMemberAction(fd), setMErr, () => {
      setMName("");
      setMPin("");
    });
  };
  const addChannel = () => {
    setCErr("");
    const fd = new FormData();
    fd.set("name", cName.trim());
    run(() => addMessengerChannelAction(fd), setCErr, () => setCName(""));
  };
  const doReset = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("pin", resetPin.trim());
    run(() => resetMessengerPinAction(fd), (e) => alert(e), () => {
      setResetFor(null);
      setResetPin("");
    });
  };
  const toggleMember = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    run(() => toggleMessengerMemberAction(fd));
  };
  const toggleChannel = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    run(() => archiveMessengerChannelAction(fd));
  };

  return (
    <div className="stack" style={{ gap: 24 }}>
      {/* 멤버 */}
      <div>
        <div className="section-label">멤버 (2차 로그인 계정)</div>
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="stack" style={{ gap: 8 }}>
            <input className="input" value={mName} onChange={(e) => setMName(e.target.value)} placeholder="이름" />
            <input
              className="input"
              type="password"
              inputMode="numeric"
              value={mPin}
              onChange={(e) => setMPin(e.target.value)}
              placeholder="개인 비밀번호(4자 이상)"
            />
            {mErr && <div className="notice notice--error">{mErr}</div>}
            <button type="button" className="btn btn--primary" onClick={addMember} disabled={pending || !mName.trim() || !mPin.trim()}>
              멤버 추가
            </button>
          </div>
        </div>
        <div className="list">
          {members.length === 0 ? (
            <div className="empty">등록된 멤버가 없어요.</div>
          ) : (
            members.map((m) => (
              <div className="row" key={m.id} style={{ flexWrap: "wrap" }}>
                <div className="row__main">
                  <div className="row__title">
                    {m.name}
                    {!m.active && <span className="badge badge--mute" style={{ marginLeft: 8 }}>비활성</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => { setResetFor(resetFor === m.id ? null : m.id); setResetPin(""); }}>
                    비번변경
                  </button>
                  <button type="button" className="btn btn--xs btn--ghost" onClick={() => toggleMember(m.id)} disabled={pending}>
                    {m.active ? "비활성" : "활성"}
                  </button>
                </div>
                {resetFor === m.id && (
                  <div style={{ display: "flex", gap: 6, width: "100%", marginTop: 8 }}>
                    <input
                      className="input"
                      type="password"
                      inputMode="numeric"
                      value={resetPin}
                      onChange={(e) => setResetPin(e.target.value)}
                      placeholder="새 비밀번호(4자 이상)"
                      style={{ flex: 1 }}
                    />
                    <button type="button" className="btn btn--xs btn--primary" onClick={() => doReset(m.id)} disabled={pending || resetPin.trim().length < 4}>
                      변경
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 채널 */}
      <div>
        <div className="section-label">채널 (주제방)</div>
        <div className="card" style={{ marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="input" value={cName} onChange={(e) => setCName(e.target.value)} placeholder="채널 이름 (예: 발주, 창고, 공지)" style={{ flex: 1 }} />
            <button type="button" className="btn btn--primary" onClick={addChannel} disabled={pending || !cName.trim()}>
              추가
            </button>
          </div>
          {cErr && <div className="notice notice--error" style={{ marginTop: 8 }}>{cErr}</div>}
        </div>
        <div className="list">
          {channels.length === 0 ? (
            <div className="empty">채널이 없어요.</div>
          ) : (
            channels.map((c) => (
              <div className="row" key={c.id}>
                <div className="row__main">
                  <div className="row__title">
                    #{c.name}
                    {c.archived && <span className="badge badge--mute" style={{ marginLeft: 8 }}>보관됨</span>}
                  </div>
                </div>
                <button type="button" className="btn btn--xs btn--ghost" onClick={() => toggleChannel(c.id)} disabled={pending}>
                  {c.archived ? "복구" : "보관"}
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
