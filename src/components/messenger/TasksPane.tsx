"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import {
  loadMessengerTasksAction,
  addMessengerTaskAction,
  toggleMessengerTaskAction,
  deleteMessengerTaskAction,
  loadMessengerMentionsAction,
  markMentionReadAction,
  type TaskDTO,
} from "@/app/actions/messenger";

type Member = { id: string; name: string; active: boolean };
type Mention = { id: string; channelId: string; channelName: string; messageId: string; by: string; preview: string; at: string };

// 날짜/시간 포맷(KST).
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

// 우리 UIUX 커스텀 드롭다운(받는 사람).
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
            <button type="button" className={`mdd__opt${value === "ALL" ? " on" : ""}`} onClick={() => { onChange("ALL"); setOpen(false); }}>
              팀원 전체
            </button>
            {members.map((m) => (
              <button key={m.id} type="button" className={`mdd__opt${value === m.id ? " on" : ""}`} onClick={() => { onChange(m.id); setOpen(false); }}>
                {m.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// 홈(메인 인트로) = 받은 멘션 토픽 + 팀 할 일 보드. 팀 전체에 모두 노출.
export function TasksPane({
  me,
  members,
  onJump,
}: {
  me: { id: string; name: string };
  members: Member[];
  onJump: (channelId: string, messageId: string) => void;
}) {
  const [tasks, setTasks] = useState<TaskDTO[]>([]);
  const [mentions, setMentions] = useState<Mention[]>([]);
  const [adding, setAdding] = useState(false); // 추가 팝업
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [target, setTarget] = useState("ALL"); // "ALL" | 멤버 id
  const [err, setErr] = useState("");
  const [detailTask, setDetailTask] = useState<TaskDTO | null>(null); // 제목 클릭 → 상세 팝업
  const [pending, start] = useTransition();
  const activeMembers = useMemo(() => members.filter((m) => m.active), [members]);
  const nameOf = (id: string | null) => (id ? members.find((m) => m.id === id)?.name ?? "지난 멤버" : "—");

  const load = async () => setTasks((await loadMessengerTasksAction()).tasks);
  useEffect(() => {
    let alive = true;
    const run = async () => {
      const [t, m] = await Promise.all([loadMessengerTasksAction(), loadMessengerMentionsAction()]);
      if (!alive) return;
      setTasks(t.tasks);
      setMentions(m.mentions);
    };
    run();
    const iv = setInterval(run, 7000);
    return () => {
      alive = false;
      clearInterval(iv);
    };
  }, []);

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
      setTitle("");
      setDetail("");
      setTarget("ALL");
      setAdding(false);
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
  // 멘션 확인(클릭) → 알림에서 제거 + 해당 채팅으로 이동.
  const openMention = (mt: Mention) => {
    setMentions((xs) => xs.filter((x) => x.id !== mt.id));
    markMentionReadAction(mt.id).catch(() => {});
    onJump(mt.channelId, mt.messageId);
  };

  const open = tasks.filter((t) => !t.done);
  const done = tasks.filter((t) => t.done);
  // 진행 중 할 일 → 올린 날짜별 그룹(최신 날짜 먼저).
  const groups = useMemo(() => {
    const map = new Map<string, TaskDTO[]>();
    for (const t of open) {
      const key = kstYmd(new Date(t.createdAt));
      const arr = map.get(key);
      if (arr) arr.push(t);
      else map.set(key, [t]);
    }
    return [...map.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)); // 최신 날짜 먼저
  }, [open]);

  const Card = (t: TaskDTO) => (
    <div className={`tcard${t.done ? " is-done" : ""}`} key={t.id}>
      <button type="button" className={`tcard__check${t.done ? " on" : ""}`} onClick={() => toggle(t.id)} aria-label="완료 체크">
        {t.done ? "✓" : ""}
      </button>
      <div className="tcard__main">
        <button type="button" className="tcard__title" onClick={() => setDetailTask(t)}>
          {t.title}
          {t.detail ? <span className="tcard__memoicon" aria-label="상세 설명 있음">﹖</span> : null}
        </button>
        <div className="tcard__who">
          <span className="tcard__from">{nameOf(t.createdById)}</span>
          <span className="tcard__arrow">→</span>
          <span className={`tcard__to${t.toAll ? " all" : ""}`}>{t.toAll ? "팀원 전체" : t.assigneeId ? nameOf(t.assigneeId) : "미지정"}</span>
          <span className="tcard__time">{fmtClock(t.createdAt)}</span>
        </div>
      </div>
      <button type="button" className="tcard__del" onClick={() => remove(t.id)} aria-label="삭제">✕</button>
    </div>
  );

  return (
    <div className="home">
      <div className="home__inner">
        <div className="home__greet">
          <div className="home__greetmain">
            <div className="home__hi">{me.name}님, 반가워요</div>
            <div className="home__sub">팀 할 일{open.length ? ` · 진행 중 ${open.length}` : ""}</div>
          </div>
          <button type="button" className="home__addfab" onClick={() => { setErr(""); setAdding(true); }} aria-label="할 일 추가">＋</button>
        </div>

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
          {open.length === 0 && done.length === 0 && (
            <div className="home__empty">할 일이 없어요. 오른쪽 위 ＋ 로 새 할 일을 추가해 보세요.</div>
          )}
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

      {/* 할 일 추가 팝업 */}
      {adding && (
        <Sheet onClose={() => setAdding(false)}>
          <div className="sheet__panel taskmodal">
            <div className="taskmodal__title">새 할 일</div>
            <input
              className="input taskmodal__field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && add()}
              placeholder="할 일 제목"
              autoFocus
            />
            <textarea
              className="input taskmodal__area"
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="상세 설명 (선택) — 제목을 누르면 여기 내용이 보여요"
              rows={3}
            />
            <TargetSelect members={activeMembers} value={target} onChange={setTarget} />
            {err && <div className="home__err">{err}</div>}
            <div className="taskmodal__actions">
              <button type="button" className="btn btn--ghost" onClick={() => setAdding(false)}>취소</button>
              <button type="button" className="btn btn--primary" onClick={add} disabled={pending || !title.trim()}>추가</button>
            </div>
          </div>
        </Sheet>
      )}

      {/* 상세 설명 팝업 */}
      {detailTask && (
        <Sheet onClose={() => setDetailTask(null)}>
          <div className="sheet__panel taskmodal">
            <div className="taskdetail__title">{detailTask.title}</div>
            <div className="taskdetail__meta">
              <span>{nameOf(detailTask.createdById)}</span>
              <span className="tcard__arrow">→</span>
              <span>{detailTask.toAll ? "팀원 전체" : detailTask.assigneeId ? nameOf(detailTask.assigneeId) : "미지정"}</span>
              <span className="taskdetail__dot">·</span>
              <span>{fmtFull(detailTask.createdAt)}</span>
            </div>
            <div className="taskdetail__body">{detailTask.detail ? detailTask.detail : "상세 설명이 없어요."}</div>
            <div className="taskmodal__actions">
              <button type="button" className="btn btn--primary" onClick={() => setDetailTask(null)}>닫기</button>
            </div>
          </div>
        </Sheet>
      )}
    </div>
  );
}
