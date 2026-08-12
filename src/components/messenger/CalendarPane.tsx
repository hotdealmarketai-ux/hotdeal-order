"use client";

import { useEffect, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import {
  loadMessengerCalendarAction,
  addMessengerEventAction,
  updateMessengerEventAction,
  deleteMessengerEventAction,
  type EventDTO,
  type CalTaskDTO,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };

const pad = (n: number) => String(n).padStart(2, "0");
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function CalendarPane({ members }: { me: { id: string; name: string }; members: Member[] }) {
  const t = todayYmd();
  const [ty, tm] = [Number(t.slice(0, 4)), Number(t.slice(5, 7))];
  const [year, setYear] = useState(ty);
  const [month, setMonth] = useState(tm); // 1~12
  const [sel, setSel] = useState<string>(t);
  const [events, setEvents] = useState<EventDTO[]>([]);
  const [tasks, setTasks] = useState<CalTaskDTO[]>([]);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [err, setErr] = useState("");
  // 일정 수정
  const [editEvent, setEditEvent] = useState<EventDTO | null>(null);
  const [eTitle, setETitle] = useState("");
  const [eDate, setEDate] = useState("");
  const [eMemo, setEMemo] = useState("");
  const [eErr, setEErr] = useState("");
  const [pending, start] = useTransition();
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "?" : null);

  const load = async () => {
    const r = await loadMessengerCalendarAction(year, month);
    setEvents(r.events);
    setTasks(r.tasks);
  };
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const r = await loadMessengerCalendarAction(year, month);
      if (!alive) return;
      setEvents(r.events);
      setTasks(r.tasks);
    };
    run();
    const iv = setInterval(run, 10000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, [year, month]);

  const move = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setYear(y);
    setMonth(m);
  };
  const goToday = () => { setYear(ty); setMonth(tm); setSel(t); };

  const daysInMonth = new Date(year, month, 0).getDate();
  const firstDow = new Date(year, month - 1, 1).getDay();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  const evByDay = (day: string) => events.filter((e) => e.date === day);
  const taskByDay = (day: string) => tasks.filter((tk) => tk.due === day);

  const selEvents = evByDay(sel);
  const selTasks = taskByDay(sel);
  const selLabel = (() => {
    const [y, m, d] = sel.split("-").map(Number);
    const dow = WEEK[new Date(y, m - 1, d).getDay()];
    return `${m}월 ${d}일 (${dow})`;
  })();

  const addEvent = () => {
    const ti = title.trim();
    if (!ti) return;
    setErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("date", sel);
      fd.set("title", ti);
      if (memo.trim()) fd.set("memo", memo.trim());
      const r = await addMessengerEventAction(fd);
      if (r?.error) return setErr(r.error);
      setTitle("");
      setMemo("");
      await load();
    });
  };
  const removeEvent = (id: string) => {
    if (!confirm("이 일정을 삭제할까요?")) return;
    setEvents((es) => es.filter((e) => e.id !== id));
    start(async () => {
      await deleteMessengerEventAction(id);
      await load();
    });
  };
  const openEdit = (e: EventDTO) => {
    setEditEvent(e);
    setETitle(e.title);
    setEDate(e.date);
    setEMemo(e.memo ?? "");
    setEErr("");
  };
  const saveEdit = () => {
    if (!editEvent) return;
    const ti = eTitle.trim();
    if (!ti) return setEErr("일정 제목을 입력하세요.");
    setEErr("");
    start(async () => {
      const fd = new FormData();
      fd.set("id", editEvent.id);
      fd.set("title", ti);
      fd.set("date", eDate);
      if (eMemo.trim()) fd.set("memo", eMemo.trim());
      const r = await updateMessengerEventAction(fd);
      if (r?.error) return setEErr(r.error);
      setEditEvent(null);
      await load();
    });
  };

  return (
    <div className="mcal">
      <div className="mcal__bar">
        <div className="mcal__title">{year}년 {month}월</div>
        <div className="mcal__nav">
          <button type="button" className="mcal__btn" onClick={() => move(-1)} aria-label="이전 달">‹</button>
          <button type="button" className="mcal__today" onClick={goToday}>오늘</button>
          <button type="button" className="mcal__btn" onClick={() => move(1)} aria-label="다음 달">›</button>
        </div>
      </div>

      <div className="mcal__grid">
        {WEEK.map((w, i) => (
          <div key={w} className={`mcal__dow${i === 0 ? " sun" : ""}${i === 6 ? " sat" : ""}`}>{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} className="mcal__cell is-empty" />;
          const day = ymd(year, month, d);
          const es = evByDay(day);
          const ts = taskByDay(day);
          const dow = i % 7;
          return (
            <button
              key={day}
              type="button"
              className={`mcal__cell${day === sel ? " is-sel" : ""}${day === t ? " is-today" : ""}`}
              onClick={() => setSel(day)}
            >
              <span className={`mcal__num${dow === 0 ? " sun" : ""}${dow === 6 ? " sat" : ""}`}>{d}</span>
              <span className="mcal__marks">
                {es.slice(0, 5).map((e) => (
                  <span key={e.id} className="mcal__ev" title={e.title}>{e.title}</span>
                ))}
                {es.length > 5 && <span className="mcal__more">+{es.length - 5}</span>}
                {ts.length > 0 && <span className="mcal__task">할일 {ts.length}</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mcal__panel">
        <div className="mcal__panelhead">{selLabel}</div>

        {selEvents.length === 0 && selTasks.length === 0 && (
          <div className="mcal__none">일정이 없어요.</div>
        )}
        {selEvents.map((e) => (
          <div className="mcal__row" key={e.id}>
            <span className="mcal__dot mcal__dot--ev" />
            <div className="mcal__rowmain">
              <div className="mcal__rowtitle">{e.title}</div>
              {e.memo && <div className="mcal__rowmemo">{e.memo}</div>}
            </div>
            <button type="button" className="mcal__edit" onClick={() => openEdit(e)}>수정</button>
            <button type="button" className="task__del" onClick={() => removeEvent(e.id)} aria-label="삭제">✕</button>
          </div>
        ))}
        {selTasks.map((tk) => (
          <div className={`mcal__row${tk.done ? " is-done" : ""}`} key={tk.id}>
            <span className="mcal__dot mcal__dot--task" />
            <div className="mcal__rowmain">
              <div className="mcal__rowtitle">{tk.title} {tk.done && <span className="mcal__doneflag">완료</span>}</div>
              <div className="mcal__rowmemo">할 일{tk.assigneeIds.length ? ` · ${tk.assigneeIds.map(nameOf).join(", ")}` : ""}</div>
            </div>
          </div>
        ))}

        <div className="mcal__add">
          <input
            className="input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addEvent()}
            placeholder="일정"
          />
          <input className="input" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="메모" />
          <button type="button" className="btn btn--primary" onClick={addEvent} disabled={pending || !title.trim()}>추가</button>
          {err && <div className="notice notice--error">{err}</div>}
        </div>
      </div>

      {editEvent && (
        <Sheet onClose={() => setEditEvent(null)}>
          <div className="sheet__panel mcaledit">
            <div className="mcaledit__title">일정 수정</div>
            <label className="mcaledit__label">제목</label>
            <input className="input" value={eTitle} onChange={(e) => setETitle(e.target.value)} placeholder="일정" autoFocus />
            <label className="mcaledit__label">날짜</label>
            <input className="input" type="date" value={eDate} onChange={(e) => setEDate(e.target.value)} />
            <label className="mcaledit__label">메모</label>
            <input className="input" value={eMemo} onChange={(e) => setEMemo(e.target.value)} placeholder="메모" />
            {eErr && <div className="notice notice--error">{eErr}</div>}
            <div className="mcaledit__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setEditEvent(null)}>취소</button>
              <button type="button" className="btn btn--primary" onClick={saveEdit} disabled={pending || !eTitle.trim()}>저장</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
