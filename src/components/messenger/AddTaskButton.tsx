"use client";

import { useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import { addMessengerTaskAction } from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };

// 받는 사람 다중 선택 드롭다운. value=["ALL"] 이면 팀원 전체, 아니면 멤버 id 목록.
function TargetMultiSelect({ members, value, onChange }: { members: Member[]; value: string[]; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const isAll = value.includes("ALL");
  const label = isAll
    ? "팀원 전체"
    : value.length === 0
      ? "선택"
      : members.filter((m) => value.includes(m.id)).map((m) => m.name).join(", ");
  const toggle = (id: string) => {
    if (id === "ALL") return onChange(["ALL"]);
    const base = value.filter((v) => v !== "ALL");
    onChange(base.includes(id) ? base.filter((v) => v !== id) : [...base, id]);
  };
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
            <button type="button" className={`mdd__opt${isAll ? " on" : ""}`} onClick={() => toggle("ALL")}>
              <span className="mdd__check">{isAll ? "✓" : ""}</span>팀원 전체
            </button>
            {members.map((m) => {
              const on = !isAll && value.includes(m.id);
              return (
                <button key={m.id} type="button" className={`mdd__opt${on ? " on" : ""}`} onClick={() => toggle(m.id)}>
                  <span className="mdd__check">{on ? "✓" : ""}</span>{m.name}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// 할 일 추가 버튼 + 팝업(홈 ＋ 버튼, 채널 헤더 버튼에서 공용). channelId 가 있으면 그 채널에 안내 메시지도 게시.
export function AddTaskButton({
  members,
  className,
  label,
  channelId,
  onAdded,
}: {
  members: Member[];
  className?: string;
  label?: React.ReactNode;
  channelId?: string;
  onAdded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [targets, setTargets] = useState<string[]>(["ALL"]);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    setErr("");
    const isAll = targets.includes("ALL");
    if (!isAll && targets.length === 0) return setErr("받는 사람을 선택하세요.");
    start(async () => {
      const fd = new FormData();
      fd.set("title", t);
      if (detail.trim()) fd.set("detail", detail.trim());
      if (isAll) fd.set("toAll", "1");
      else targets.forEach((id) => fd.append("assigneeIds", id));
      if (channelId) fd.set("channelId", channelId);
      const r = await addMessengerTaskAction(fd);
      if (r?.error) return setErr(r.error);
      setTitle(""); setDetail(""); setTargets(["ALL"]); setOpen(false);
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
            <TargetMultiSelect members={activeMembers} value={targets} onChange={setTargets} />
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
