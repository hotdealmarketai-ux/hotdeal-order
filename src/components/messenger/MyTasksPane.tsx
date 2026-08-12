"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import { TaskFormSheet } from "./TaskFormSheet";
import {
  loadMyMessengerTasksAction,
  toggleMessengerTaskAction,
  type TaskDTO,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };

const kstYmd = (d: Date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const fmtClock = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
const fmtFull = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso));
const dayLabel = (ymd: string) => {
  const today = kstYmd(new Date());
  const yday = kstYmd(new Date(Date.now() - 86400000));
  if (ymd === today) return "오늘";
  if (ymd === yday) return "어제";
  return new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short" }).format(
    new Date(`${ymd}T00:00:00+09:00`),
  );
};

// 내 할일 = 나에게 배정된(또는 팀원 전체) 할 일만. 체크는 전역 반영(같은 task).
export function MyTasksPane({ me, members }: { me: { id: string; name: string }; members: Member[] }) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [detailTask, setDetailTask] = useState<TaskDTO | null>(null);
  const [editTask, setEditTask] = useState<TaskDTO | null>(null);
  const [, start] = useTransition();
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "지난 멤버" : "—");

  const load = async () => setTasks((await loadMyMessengerTasksAction()).tasks);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const t = await loadMyMessengerTasksAction();
      if (alive) setTasks(t.tasks);
    };
    run();
    const iv = setInterval(run, 7000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const toggle = (id: string) => {
    const cur = tasks.find((t) => t.id === id);
    if (cur && !cur.done && !confirm("정말 완료했습니까?")) return; // 완료로 체크할 때만 재확인
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    start(async () => { await toggleMessengerTaskAction(id); await load(); });
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  const groups = useMemo(() => {
    const map = new Map<string, TaskDTO[]>();
    for (const t of open) {
      const key = kstYmd(new Date(t.createdAt));
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [open]);

  const Card = (t: TaskDTO) => (
    <div className={`tcard${t.done ? " is-done" : ""}`} key={t.id}>
      <button type="button" className={`tcard__check${t.done ? " on" : ""}`} onClick={() => toggle(t.id)} aria-label="완료 체크">{t.done ? "✓" : ""}</button>
      <div className="tcard__main">
        <button type="button" className="tcard__title" onClick={() => setDetailTask(t)}>
          {t.title}
          {t.detail ? <span className="tcard__memoicon" aria-label="내용 있음">﹖</span> : null}
        </button>
        <div className="tcard__who">
          <span className="tcard__from">{nameOf(t.createdById)}</span>
          <span className="tcard__arrow">→</span>
          <span className={`tcard__to${t.toAll ? " all" : ""}`}>{t.toAll ? "팀원 전체" : t.assigneeIds.length ? t.assigneeIds.map(nameOf).join(", ") : "미지정"}</span>
          <span className="tcard__time">{fmtClock(t.createdAt)}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__greet">
          <div className="home__greetmain">
            <div className="home__hi">내 할일</div>
            {open.length > 0 && <div className="home__sub">할 일 {open.length}</div>}
          </div>
        </div>

        <div className="home__list">
          {open.length === 0 && done.length === 0 && <div className="home__empty">나에게 배정된 할 일이 없어요.</div>}
          {groups.map(([ymd, list]) => (
            <div className="home__group" key={ymd}>
              <div className="home__daylabel">{dayLabel(ymd)}</div>
              {list.map(Card)}
            </div>
          ))}
          {done.length > 0 && (
            <div className="home__group">
              <div className="home__donelabel">완료 {done.length}</div>
              {done.map(Card)}
            </div>
          )}
        </div>
      </div>

      {detailTask && (
        <Sheet onClose={() => setDetailTask(null)}>
          <div className="sheet__panel taskmodal">
            <div className="taskdetail__title">{detailTask.title}</div>
            <div className="taskdetail__meta">
              <span>{nameOf(detailTask.createdById)}</span>
              <span className="tcard__arrow">→</span>
              <span>{detailTask.toAll ? "팀원 전체" : detailTask.assigneeIds.length ? detailTask.assigneeIds.map(nameOf).join(", ") : "미지정"}</span>
              <span className="taskdetail__dot">·</span>
              <span>{fmtFull(detailTask.createdAt)}</span>
            </div>
            <div className="taskdetail__body">{detailTask.detail ? detailTask.detail : "내용이 없어요."}</div>
            <div className="taskmodal__actions">
              {detailTask.createdById === me.id && (
                <button type="button" className="btn btn--ghost" onClick={() => { setEditTask(detailTask); setDetailTask(null); }}>수정</button>
              )}
              <button type="button" className="btn btn--primary" onClick={() => setDetailTask(null)}>닫기</button>
            </div>
          </div>
        </Sheet>
      )}

      {editTask && <TaskFormSheet members={members} editTask={editTask} onClose={() => setEditTask(null)} onDone={load} />}
    </div>
  );
}
