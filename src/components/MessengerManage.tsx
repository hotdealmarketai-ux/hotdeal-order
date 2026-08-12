"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addMessengerMemberAction,
  resetMessengerPinAction,
  deleteMessengerMemberAction,
  addMessengerChannelAction,
  renameMessengerChannelAction,
  deleteMessengerChannelAction,
  reorderMessengerChannelAction,
  addMessengerChannelGroupAction,
  renameMessengerChannelGroupAction,
  deleteMessengerChannelGroupAction,
  reorderMessengerChannelGroupAction,
  setMessengerChannelGroupAction,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };
type Channel = { id: string; name: string; archived: boolean; groupId: string | null };
type Group = { id: string; name: string };

export function MessengerManage({ members, channels, groups }: { members: Member[]; channels: Channel[]; groups: Group[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [mName, setMName] = useState("");
  const [mPin, setMPin] = useState("");
  const [mErr, setMErr] = useState("");
  const [cName, setCName] = useState("");
  const [cErr, setCErr] = useState("");
  const [pinFor, setPinFor] = useState<string | null>(null);
  const [pinVal, setPinVal] = useState("");
  const [renFor, setRenFor] = useState<string | null>(null);
  const [renVal, setRenVal] = useState("");
  const [gName, setGName] = useState("");
  const [gErr, setGErr] = useState("");
  const [gRenFor, setGRenFor] = useState<string | null>(null);
  const [gRenVal, setGRenVal] = useState("");

  const run = (
    fn: () => Promise<{ error?: string } | void>,
    onErr?: (e: string) => void,
    onOk?: () => void,
  ) =>
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
    run(() => addMessengerMemberAction(fd), setMErr, () => { setMName(""); setMPin(""); });
  };
  const doPin = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("pin", pinVal.trim());
    run(() => resetMessengerPinAction(fd), (e) => alert(e), () => { setPinFor(null); setPinVal(""); });
  };
  const delMember = (id: string, name: string) => {
    if (!confirm(`'${name}' 멤버를 삭제할까요?\n이 멤버가 보낸 메시지도 함께 사라지며 되돌릴 수 없어요.`)) return;
    const fd = new FormData();
    fd.set("id", id);
    run(() => deleteMessengerMemberAction(fd));
  };

  const addChannel = () => {
    setCErr("");
    const fd = new FormData();
    fd.set("name", cName.trim());
    run(() => addMessengerChannelAction(fd), setCErr, () => setCName(""));
  };
  const doRename = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", renVal.trim());
    run(() => renameMessengerChannelAction(fd), (e) => alert(e), () => { setRenFor(null); setRenVal(""); });
  };
  const delChannel = (id: string, name: string) => {
    if (!confirm(`'#${name}' 채널을 삭제할까요?\n이 채널의 모든 대화·사진·파일이 영구 삭제되며 되돌릴 수 없어요.`)) return;
    const fd = new FormData();
    fd.set("id", id);
    run(() => deleteMessengerChannelAction(fd));
  };
  const move = (id: string, dir: "up" | "down") => run(() => reorderMessengerChannelAction(id, dir));
  const setGroup = (channelId: string, groupId: string) => {
    const fd = new FormData();
    fd.set("channelId", channelId);
    fd.set("groupId", groupId);
    run(() => setMessengerChannelGroupAction(fd));
  };
  const addGroup = () => {
    setGErr("");
    const fd = new FormData();
    fd.set("name", gName.trim());
    run(() => addMessengerChannelGroupAction(fd), setGErr, () => setGName(""));
  };
  const gRename = (id: string) => {
    const fd = new FormData();
    fd.set("id", id);
    fd.set("name", gRenVal.trim());
    run(() => renameMessengerChannelGroupAction(fd), (e) => alert(e), () => { setGRenFor(null); setGRenVal(""); });
  };
  const gDel = (id: string, name: string) => {
    if (!confirm(`'${name}' 그룹을 삭제할까요?\n채널은 지워지지 않고 '그룹 없음'으로 이동합니다.`)) return;
    const fd = new FormData();
    fd.set("id", id);
    run(() => deleteMessengerChannelGroupAction(fd));
  };
  const gMove = (id: string, dir: "up" | "down") => run(() => reorderMessengerChannelGroupAction(id, dir));

  return (
    <div className="stack" style={{ gap: 24 }}>
      {/* 멤버 */}
      <div>
        <div className="section-label">멤버</div>
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
                  <div className="row__title">{m.name}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => { setPinFor(pinFor === m.id ? null : m.id); setPinVal(""); }}>
                    비밀번호 변경
                  </button>
                  <button type="button" className="btn btn--xs btn--danger" onClick={() => delMember(m.id, m.name)} disabled={pending}>
                    삭제
                  </button>
                </div>
                {pinFor === m.id && (
                  <div style={{ display: "flex", gap: 6, width: "100%", marginTop: 8 }}>
                    <input
                      className="input"
                      type="password"
                      inputMode="numeric"
                      value={pinVal}
                      onChange={(e) => setPinVal(e.target.value)}
                      placeholder="새 비밀번호(4자 이상)"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button type="button" className="btn btn--xs btn--primary" onClick={() => doPin(m.id)} disabled={pending || pinVal.trim().length < 4}>
                      변경
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 채널 그룹 */}
      <div>
        <div className="section-label">채널 그룹 (단 나누기)</div>
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="mwm__addrow">
            <input
              className="input mwm__addinput"
              value={gName}
              onChange={(e) => setGName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && gName.trim() && addGroup()}
              placeholder="그룹 이름 (예: 매장, 물류, 공지)"
            />
            <button type="button" className="btn btn--xs btn--primary mwm__addbtn" onClick={addGroup} disabled={pending || !gName.trim()}>
              추가
            </button>
          </div>
          {gErr && <div className="notice notice--error" style={{ marginTop: 8 }}>{gErr}</div>}
        </div>
        <div className="list">
          {groups.length === 0 ? (
            <div className="empty">그룹이 없어요. 그룹을 만들면 아래 채널을 단으로 나눠 볼 수 있어요.</div>
          ) : (
            groups.map((g, i) => (
              <div className="row" key={g.id} style={{ flexWrap: "wrap" }}>
                <div className="row__main"><div className="row__title">{g.name}</div></div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => gMove(g.id, "up")} disabled={pending || i === 0} aria-label="위로">↑</button>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => gMove(g.id, "down")} disabled={pending || i === groups.length - 1} aria-label="아래로">↓</button>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => { setGRenFor(gRenFor === g.id ? null : g.id); setGRenVal(g.name); }}>이름 수정</button>
                  <button type="button" className="btn btn--xs btn--danger" onClick={() => gDel(g.id, g.name)} disabled={pending}>삭제</button>
                </div>
                {gRenFor === g.id && (
                  <div style={{ display: "flex", gap: 6, width: "100%", marginTop: 8 }}>
                    <input
                      className="input"
                      value={gRenVal}
                      onChange={(e) => setGRenVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && gRenVal.trim() && gRename(g.id)}
                      placeholder="새 그룹 이름"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button type="button" className="btn btn--xs btn--primary" onClick={() => gRename(g.id)} disabled={pending || !gRenVal.trim()}>변경</button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>

      {/* 채널 */}
      <div>
        <div className="section-label">채널</div>
        <div className="card" style={{ marginBottom: 10 }}>
          <div className="mwm__addrow">
            <input
              className="input mwm__addinput"
              value={cName}
              onChange={(e) => setCName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && cName.trim() && addChannel()}
              placeholder="채널 이름 (예: 발주, 창고, 공지)"
            />
            <button type="button" className="btn btn--xs btn--primary mwm__addbtn" onClick={addChannel} disabled={pending || !cName.trim()}>
              추가
            </button>
          </div>
          {cErr && <div className="notice notice--error" style={{ marginTop: 8 }}>{cErr}</div>}
        </div>
        <div className="list">
          {channels.length === 0 ? (
            <div className="empty">채널이 없어요.</div>
          ) : (
            channels.map((c, i) => (
              <div className="row" key={c.id} style={{ flexWrap: "wrap" }}>
                <div className="row__main">
                  <div className="row__title">
                    #{c.name}
                    {c.archived && <span className="badge badge--mute" style={{ marginLeft: 8 }}>보관됨</span>}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => move(c.id, "up")} disabled={pending || i === 0} aria-label="위로">↑</button>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => move(c.id, "down")} disabled={pending || i === channels.length - 1} aria-label="아래로">↓</button>
                  <button type="button" className="btn btn--xs btn--soft" onClick={() => { setRenFor(renFor === c.id ? null : c.id); setRenVal(c.name); }}>
                    이름 수정
                  </button>
                  <button type="button" className="btn btn--xs btn--danger" onClick={() => delChannel(c.id, c.name)} disabled={pending}>
                    삭제
                  </button>
                </div>
                {renFor === c.id && (
                  <div style={{ display: "flex", gap: 6, width: "100%", marginTop: 8 }}>
                    <input
                      className="input"
                      value={renVal}
                      onChange={(e) => setRenVal(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && renVal.trim() && doRename(c.id)}
                      placeholder="새 채널 이름"
                      style={{ flex: 1, minWidth: 0 }}
                    />
                    <button type="button" className="btn btn--xs btn--primary" onClick={() => doRename(c.id)} disabled={pending || !renVal.trim()}>
                      변경
                    </button>
                  </div>
                )}
                {groups.length > 0 && (
                  <div style={{ width: "100%", marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 700 }}>그룹</span>
                    <select className="input" style={{ flex: 1, minWidth: 0 }} value={c.groupId ?? ""} onChange={(e) => setGroup(c.id, e.target.value)}>
                      <option value="">그룹 없음</option>
                      {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
