"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  loadMessengerTasksAction,
  addMessengerTaskAction,
  toggleMessengerTaskAction,
  deleteMessengerTaskAction,
  type TaskDTO,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };

const todayYmd = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()); // yyyy-mm-dd
const fmtDue = (ymd: string) => {
  const [, m, d] = ymd.split("-");
  return `${Number(m)}/${Number(d)}`;
};

export function TasksPane({ me, members }: { me: { id: string; name: string }; members: Member[] }) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [due, setDue] = useState("");
  const [err, setErr] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [pending, start] = useTransition();
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "?" : null);
  const today = todayYmd();

  const load = async () => {
    const r = await loadMessengerTasksAction();
    setTasks(r.tasks);
  };
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const r = await loadMessengerTasksAction();
      if (alive) setTasks(r.tasks);
    };
    run();
    const t = setInterval(run, 7000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const add = () => {
    const t = title.trim();
    if (!t) return;
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("title", t);
      if (assignee) fd.set("assigneeId", assignee);
      if (due) fd.set("due", due);
      const r = await addMessengerTaskAction(fd);
      if (r?.error) return setErr(r.error);
      setTitle("");
      setAssignee("");
      setDue("");
      await load();
    });
  };
  const toggle = (id: string) => {
    // 낙관적 업데이트
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    start(async () => {
      await toggleMessengerTaskAction(id);
      await load();
    });
  };
  const remove = (id: string) => {
    if (!confirm("이 할 일을 삭제할까요?")) return;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    start(async () => {
      await deleteMessengerTaskAction(id);
      await load();
    });
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);

  const Row = (t: TaskDTO) => {
    const overdue = !t.done && t.due && t.due < today;
    return (
      <div className={`task${t.done ? " is-done" : ""}`} key={t.id}>
        <button type="button" className={`task__check${t.done ? " on" : ""}`} onClick={() => toggle(t.id)} aria-label="완료 토글">
          {t.done ? "✓" : ""}
        </button>
        <div className="task__main">
          <div className="task__title">{t.title}</div>
          <div className="task__meta">
            {t.assigneeId && <span className="task__who">{nameOf(t.assigneeId)}</span>}
            {t.due && <span className={`task__due${overdue ? " over" : ""}`}>📅 {fmtDue(t.due)}</span>}
          </div>
        </div>
        <button type="button" className="task__del" onClick={() => remove(t.id)} aria-label="삭제">✕</button>
      </div>
    );
  };

  return (
    <div className="tasks">
      <div className="tasks__add">
        <input
          className="input tasks__title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="할 일을 입력하고 Enter"
        />
        <div className="tasks__addopts">
          <select className="input select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">담당자 없음</option>
            {members.filter((m) => m.active).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
          <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
          <button type="button" className="btn btn--primary" onClick={add} disabled={pending || !title.trim()}>추가</button>
        </div>
        {err && <div className="notice notice--error">{err}</div>}
      </div>

      <div className="tasks__list">
        <div className="tasks__sec">해야 할 일 <span className="tasks__count">{open.length}</span></div>
        {open.length === 0 ? <div className="tasks__empty">할 일이 없어요. 깔끔하네요 👍</div> : open.map(Row)}

        {done.length > 0 && (
          <>
            <button type="button" className="tasks__donehead" onClick={() => setShowDone((v) => !v)}>
              {showDone ? "▾" : "▸"} 완료됨 <span className="tasks__count">{done.length}</span>
            </button>
            {showDone && done.map(Row)}
          </>
        )}
      </div>
    </div>
  );
}
