"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import { AddTaskButton } from "./AddTaskButton";
import {
  loadMessengerTasksAction,
  toggleMessengerTaskAction,
  deleteMessengerTaskAction,
  loadMessengerMentionsAction,
  markMentionReadAction,
  loadMessengerWeekAgendaAction,
  searchMessengerAllAction,
  type TaskDTO,
  type WeekItemDTO,
  type GlobalHitDTO,
} from "@/app/actions/messenger";

const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];
const wdOf = (ymd: string) => WEEKDAY[new Date(`${ymd}T00:00:00Z`).getUTCDay()];
const mdOf = (ymd: string) => { const [, m, d] = ymd.split("-"); return `${Number(m)}/${Number(d)}`; };

type Member = { id: string; name: string; active: boolean };
type Channel = { id: string; name: string };
type Mention = { id: string; channelId: string; channelName: string; messageId: string; by: string; preview: string; at: string };

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

// 홈 = 전체 검색 + 즐겨찾기 + 오늘 일정 + 받은 멘션 + 팀 할 일.
export function TasksPane({
  me,
  members,
  favorites,
  onJump,
  onOpenChannel,
}: {
  me: { id: string; name: string };
  members: Member[];
  favorites: Channel[];
  onJump: (channelId: string, messageId: string) => void;
  onOpenChannel: (channelId: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [week, setWeek] = useState<WeekItemDTO[]>([]);
  const [detailTask, setDetailTask] = useState<TaskDTO | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GlobalHitDTO[]>([]);
  const [, start] = useTransition();
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "지난 멤버" : "—");

  const load = async () => setTasks((await loadMessengerTasksAction()).tasks);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const [t, m, a] = await Promise.all([loadMessengerTasksAction(), loadMessengerMentionsAction(), loadMessengerWeekAgendaAction()]);
      if (!alive) return;
      setTasks(t.tasks);
      setMentions(m.mentions);
      setWeek(a.items);
    };
    run();
    const iv = setInterval(run, 7000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  // 전 채널 대화 검색(디바운스).
  useEffect(() => {
    const query = search.trim();
    if (!query) { setResults([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      searchMessengerAllAction(query).then((r) => { if (alive) setResults(r.hits); });
    }, 240);
    return () => { alive = false; clearTimeout(t); };
  }, [search]);

  const toggle = (id: string) => {
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));
    start(async () => { await toggleMessengerTaskAction(id); await load(); });
  };
  const remove = (id: string) => {
    if (!confirm("이 할 일을 삭제할까요?")) return;
    setTasks((ts) => ts.filter((t) => t.id !== id));
    start(async () => { await deleteMessengerTaskAction(id); await load(); });
  };
  const openMention = (mt: Mention) => {
    setMentions((xs) => xs.filter((x) => x.id !== mt.id));
    markMentionReadAction(mt.id).catch(() => {});
    onJump(mt.channelId, mt.messageId);
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
      <button type="button" className="tcard__del" onClick={() => remove(t.id)} aria-label="삭제">✕</button>
    </div>
  );

  const searching = search.trim().length > 0;

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__greet">
          <div className="home__greetmain">
            <div className="home__hi">{me.name}님, 반가워요</div>
            <div className="home__sub">{open.length ? `할 일 ${open.length}` : "오늘도 좋은 하루"}</div>
          </div>
          <AddTaskButton members={members} className="home__addfab" label="＋" onAdded={load} />
        </div>

        <div className="home__searchbar">
          <svg className="home__searchicon" width="17" height="17" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" /><path d="M20 20l-3.2-3.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          <input className="home__searchinput" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="전체 채널 대화 검색" />
          {search && <button type="button" className="home__searchclear" onClick={() => setSearch("")} aria-label="지우기">✕</button>}
        </div>

        {searching ? (
          <div className="home__results">
            {results.length === 0 ? (
              <div className="home__empty">검색 결과가 없어요.</div>
            ) : (
              results.map((h) => (
                <button key={h.messageId} type="button" className="home__result" onClick={() => onJump(h.channelId, h.messageId)}>
                  <span className="home__resultch"># {h.channelName}</span>
                  <span className="home__resultbody"><b>{h.name}</b> {h.body || "사진"}</span>
                </button>
              ))
            )}
          </div>
        ) : (
          <>
            {favorites.length > 0 && (
              <div className="home__favs">
                {favorites.map((c) => (
                  <button key={c.id} type="button" className="home__fav" onClick={() => onOpenChannel(c.id)}>★ {c.name}</button>
                ))}
              </div>
            )}

            {week.length > 0 && (
              <div className="home__today">
                <div className="home__sectitle">이번 주 일정</div>
                {week.map((it) => {
                  const isToday = it.date === kstYmd(new Date());
                  return (
                    <div className="home__todayrow" key={`${it.kind}-${it.id}`}>
                      <span className={`home__todayday${isToday ? " is-today" : ""}`}>{mdOf(it.date)} {wdOf(it.date)}</span>
                      <span className={`home__todaydot home__todaydot--${it.kind}`} />
                      <span className="home__todaytitle">{it.title}</span>
                      {it.who && <span className="home__todaywho">{it.who}</span>}
                      {it.memo && <span className="home__todaymemo">{it.memo}</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {mentions.length > 0 && (
              <div className="home__mentions">
                <div className="home__sectitle">받은 멘션</div>
                {mentions.map((mt) => (
                  <button key={mt.id} type="button" className="mtopic" onClick={() => openMention(mt)}>
                    <span className="mtopic__ch"># {mt.channelName}</span>
                    <span className="mtopic__body"><b>{mt.by}</b> {mt.preview}</span>
                    <span className="mtopic__go">이동 ›</span>
                  </button>
                ))}
              </div>
            )}

            <div className="home__list">
              {open.length === 0 && done.length === 0 && <div className="home__empty">할 일이 없어요.</div>}
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
          </>
        )}
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
              <button type="button" className="btn btn--primary" onClick={() => setDetailTask(null)}>닫기</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
