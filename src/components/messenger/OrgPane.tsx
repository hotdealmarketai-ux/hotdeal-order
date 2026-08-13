"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { Sheet } from "@/components/Sheet";
import {
  loadOrgChartAction,
  loadMemberRecurringAction,
  toggleRecurringCompletionAction,
  deleteRecurringTaskAction,
  type OrgMemberDTO,
  type RecurringDTO,
} from "@/app/actions/messenger";
import { RecurringFormSheet, WEEKDAYS } from "./RecurringFormSheet";

type Detail = { name: string; canCheck: boolean; tasks: RecurringDTO[] };

const pctVar = (p: number) => ({ "--p": p }) as CSSProperties;
const WdChips = ({ days, off }: { days: number; off?: boolean }) => (
  <div className="rtask__wd">
    {days === 127 ? (
      <span className="wd wd--every">매일</span>
    ) : (
      WEEKDAYS.map((w, i) => ((days >> i) & 1 ? <span className="wd" key={i}>{w}</span> : null))
    )}
    {off ? <span className="wd">오늘 아님</span> : null}
  </div>
);

// 조직도 — 멤버별 오늘 반복 할일 진행률(목록) + 멤버 상세(체크·관리).
// sel(선택 멤버)/onSel은 Workspace가 소유(뒤로가기 히스토리에 포함되게).
export function OrgPane({
  me,
  sel,
  onSel,
}: {
  me: { id: string; name: string };
  sel: string | null;
  onSel: (id: string | null) => void;
}) {
  const [rows, setRows] = useState<OrgMemberDTO[]>([]);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [addFor, setAddFor] = useState<{ id: string; name: string } | null>(null);
  const [editTask, setEditTask] = useState<RecurringDTO | null>(null);
  const [menuTask, setMenuTask] = useState<RecurringDTO | null>(null);
  const [, start] = useTransition();

  // 목록 폴링(상세 볼 땐 중지)
  useEffect(() => {
    if (sel) return;
    let alive = true;
    const run = async () => { const r = await loadOrgChartAction(); if (alive) setRows(r.members); };
    run();
    const iv = setInterval(() => { if (typeof document !== "undefined" && document.hidden) return; run(); }, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, [sel]);

  // 상세 폴링
  const loadDetail = async (id: string) => setDetail(await loadMemberRecurringAction(id));
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let alive = true;
    const run = async () => { const r = await loadMemberRecurringAction(sel); if (alive) setDetail(r); };
    run();
    const iv = setInterval(() => { if (typeof document !== "undefined" && document.hidden) return; run(); }, 6000);
    return () => { alive = false; clearInterval(iv); };
  }, [sel]);

  const toggle = (t: RecurringDTO) => {
    if (!t.canCheck || !sel) return;
    const on = !t.done;
    setDetail((d) => (d ? { ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, done: on } : x)) } : d));
    start(async () => { await toggleRecurringCompletionAction(t.id, on); await loadDetail(sel); });
  };
  const remove = (t: RecurringDTO) => {
    if (!sel || !confirm("이 반복 할일을 삭제할까요?")) return;
    setDetail((d) => (d ? { ...d, tasks: d.tasks.filter((x) => x.id !== t.id) } : d));
    start(async () => { await deleteRecurringTaskAction(t.id); await loadDetail(sel); });
  };

  // ── 목록 ──
  if (!sel) {
    return (
      <div className="org">
        <div className="org__head">오늘 반복 할일 진행률</div>
        {rows.length === 0 && <div className="org__empty">멤버가 없어요.</div>}
        <div className="org__list">
          {rows.map((m) => {
            const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
            const complete = m.total > 0 && m.done === m.total;
            const none = m.total === 0;
            return (
              <button key={m.id} type="button" className="org__member" onClick={() => onSel(m.id)}>
                <span className={`ring${complete ? " full" : ""}${none ? " none" : ""}`} style={pctVar(pct)}>
                  <span className="ring__ava">{m.name.slice(0, 1)}</span>
                </span>
                <span className="org__minfo">
                  <span className="org__mname">{m.name}{m.id === me.id ? <em> (나)</em> : null}</span>
                  {none ? (
                    <span className="org__mnone">오늘 반복 할일 없음</span>
                  ) : (
                    <span className="org__msub">오늘 {m.done} / {m.total} 완료</span>
                  )}
                </span>
                {none ? (
                  <span className="org__pct org__pct--none">—</span>
                ) : complete ? (
                  <span className="org__donechip">업무 완료</span>
                ) : (
                  <span className="org__pct">{pct}<small>%</small></span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // ── 멤버 상세 ──
  const todayTasks = detail ? detail.tasks.filter((t) => t.appliesToday) : [];
  const total = todayTasks.length;
  const done = todayTasks.filter((t) => t.done).length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const complete = total > 0 && done === total;
  return (
    <div className="org">
      <div className="org__dbar">
        <button type="button" className="org__back" onClick={() => onSel(null)}>‹ 조직도</button>
        {detail && <button type="button" className="org__addbtn" onClick={() => setAddFor({ id: sel, name: detail.name })}>＋ 반복 할일</button>}
      </div>

      <div className="org__hero">
        <div className={`donut${complete ? " full" : ""}`} style={pctVar(pct)}>
          <span className="donut__v">{total === 0 ? "—" : <>{pct}<small>%</small></>}</span>
        </div>
        <div className="org__hname">{detail?.name ?? ""}{sel === me.id ? <em> (나)</em> : null}</div>
        <div className={`org__hsub${complete ? " done" : ""}`}>
          {total === 0 ? "오늘 반복 할일 없음" : complete ? "업무 완료 · 100%" : `오늘 ${done} / ${total} 완료`}
        </div>
      </div>
      {detail && !detail.canCheck && total > 0 && <div className="org__hint">체크는 본인만 · 여기선 보기·관리만</div>}

      <div className="org__tasks">
        {detail && detail.tasks.length === 0 && <div className="org__empty">등록된 반복 할일이 없어요. ＋로 추가하세요.</div>}
        {detail?.tasks.map((t) => (
          <div className={`rtask${t.appliesToday ? "" : " rtask--off"}${t.done ? " is-done" : ""}`} key={t.id}>
            <button type="button" className={`rtask__check${t.done ? " on" : ""}`} onClick={() => toggle(t)} disabled={!t.canCheck} aria-label="완료 체크">{t.done ? "✓" : ""}</button>
            <div className="rtask__main">
              <div className="rtask__title">{t.title}</div>
              <WdChips days={t.days} off={!t.appliesToday} />
            </div>
            <button type="button" className="rtask__more" onClick={() => setMenuTask(t)} aria-label="더보기">⋯</button>
          </div>
        ))}
      </div>

      {menuTask && (
        <Sheet onClose={() => setMenuTask(null)}>
          <div className="sheet__panel rmenu">
            <div className="rmenu__t">{menuTask.title} <span>· 반복 할일</span></div>
            <button type="button" className="rmenu__item" onClick={() => { setEditTask(menuTask); setMenuTask(null); }}>수정</button>
            <button type="button" className="rmenu__item rmenu__item--del" onClick={() => { const t = menuTask; setMenuTask(null); remove(t); }}>삭제</button>
          </div>
        </Sheet>
      )}
      {addFor && <RecurringFormSheet memberId={addFor.id} memberName={addFor.name} onClose={() => setAddFor(null)} onDone={() => loadDetail(sel)} />}
      {editTask && <RecurringFormSheet memberId={editTask.memberId} editTask={editTask} onClose={() => setEditTask(null)} onDone={() => loadDetail(sel)} />}
    </div>
  );
}
