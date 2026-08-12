"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadMessengerTasksAction,
  addMessengerTaskAction,
  toggleMessengerTaskAction,
  deleteMessengerTaskAction,
  type TaskDTO,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };

// 홈(메인 인트로) = 팀 할 일 보드. 팀 전체에 모두 노출. 제목 + 보낸사람(시킨사람)→받는사람 + 체크.
export function TasksPane({ me, members }: { me: { id: string; name: string }; members: Member[] }) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState("ALL"); // "ALL" | 멤버 id
  const [err, setErr] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [pending, start] = useTransition();
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "지난 멤버" : "—");

  const load = async () => setTasks((await loadMessengerTasksAction()).tasks);
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
      if (target === "ALL") fd.set("toAll", "1");
      else fd.set("assigneeId", target);
      const r = await addMessengerTaskAction(fd);
      if (r?.error) return setErr(r.error);
      setTitle("");
      await load();
    });
  };
  const toggle = (id: string) => {
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

  const Card = (t: TaskDTO) => (
    <div className={`tcard${t.done ? " is-done" : ""}`} key={t.id}>
      <button type="button" className={`tcard__check${t.done ? " on" : ""}`} onClick={() => toggle(t.id)} aria-label="완료 체크">
        {t.done ? "✓" : ""}
      </button>
      <div className="tcard__main">
        <div className="tcard__title">{t.title}</div>
        <div className="tcard__who">
          <span className="tcard__from">{nameOf(t.createdById)}</span>
          <span className="tcard__arrow">→</span>
          <span className={`tcard__to${t.toAll ? " all" : ""}`}>{t.toAll ? "팀원 전체" : nameOf(t.assigneeId)}</span>
        </div>
      </div>
      <button type="button" className="tcard__del" onClick={() => remove(t.id)} aria-label="삭제">✕</button>
    </div>
  );

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__greet">
          <div className="home__hi">{me.name}님, 반가워요</div>
          <div className="home__sub">팀 할 일{open.length ? ` · 진행 중 ${open.length}` : ""}</div>
        </div>

        <div className="home__add">
          <input
            className="home__title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="할 일을 입력하세요"
          />
          <div className="home__addrow">
            <select className="home__select" value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="ALL">받는 사람 · 팀원 전체</option>
              {members.filter((m) => m.active).map((m) => (
                <option key={m.id} value={m.id}>받는 사람 · {m.name}</option>
              ))}
            </select>
            <button type="button" className="home__addbtn" onClick={add} disabled={pending || !title.trim()}>추가</button>
          </div>
          {err && <div className="home__err">{err}</div>}
        </div>

        <div className="home__list">
          {open.length === 0 ? (
            <div className="home__empty">할 일이 없어요. 새 할 일을 추가해 보세요.</div>
          ) : (
            open.map(Card)
          )}
          {done.length > 0 && (
            <>
              <button type="button" className="home__donehead" onClick={() => setShowDone((v) => !v)}>
                {showDone ? "▾" : "▸"} 완료 {done.length}
              </button>
              {showDone && done.map(Card)}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
