"use client";

import { useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import { addMessengerTaskAction } from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };

// 받는 사람 커스텀 드롭다운(홈/채널 공용).
function TargetSelect({ members, value, onChange }: { members: Member[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const label = value === "ALL" ? "팀원 전체" : members.find((m) => m.id === value)?.name ?? "선택";
  return (
    <div className="mdd">
      <button type="button" className={`mdd__btn${open ? " is-open" : ""}`} onClick={() => setOpen((o) => !o)}>
        <span className="mdd__k">받는 사람</span>
        <span className="mdd__v">{label}</span>
        <span className="mdd__caret" aria-hidden>▾</span>
      </button>
      {open && (
        <>
          <div className="mdd__scrim" onClick={() => setOpen(false)} />
          <div className="mdd__pop" role="listbox">
            <button type="button" className={`mdd__opt${value === "ALL" ? " on" : ""}`} onClick={() => { onChange("ALL"); setOpen(false); }}>팀원 전체</button>
            {members.map((m) => (
              <button key={m.id} type="button" className={`mdd__opt${value === m.id ? " on" : ""}`} onClick={() => { onChange(m.id); setOpen(false); }}>{m.name}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 할 일 추가 버튼 + 팝업(홈 ＋ 버튼, 채널 헤더 버튼에서 공용으로 사용).
export function AddTaskButton({
  members,
  className,
  label,
  onAdded,
}: {
  members: Member[];
  className?: string;
  label?: React.ReactNode;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [target, setTarget] = useState("ALL");
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("title", t);
      if (detail.trim()) fd.set("detail", detail.trim());
      if (target === "ALL") fd.set("toAll", "1");
      else fd.set("assigneeId", target);
      const r = await addMessengerTaskAction(fd);
      if (r?.error) return setErr(r.error);
      setTitle(""); setDetail(""); setTarget("ALL"); setOpen(false);
      onAdded?.();
    });
  };

  return (
    <>
      <button type="button" className={className} onClick={() => { setErr(""); setOpen(true); }} aria-label="할 일 추가">
        {label}
      </button>
      {open && (
        <Sheet onClose={() => setOpen(false)}>
          <div className="sheet__panel taskmodal">
            <div className="taskmodal__title">새 할 일</div>
            <input
              className="input taskmodal__field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && add()}
              placeholder="할 일"
              autoFocus
            />
            <textarea className="input taskmodal__area" value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="내용" rows={3} />
            <TargetSelect members={activeMembers} value={target} onChange={setTarget} />
            {err && <div className="home__err">{err}</div>}
            <div className="taskmodal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setOpen(false)}>취소</button>
              <button type="button" className="btn btn--primary" onClick={add} disabled={pending || !title.trim()}>추가</button>
            </div>
          </div>
        </Sheet>
      )}
    </>
  );
}
