"use client";

import { useEffect, useState, useTransition } from "react";
import {
  loadOrgChartAction,
  loadMemberRecurringAction,
  toggleRecurringCompletionAction,
  deleteRecurringTaskAction,
  type OrgMemberDTO,
  type RecurringDTO,
} from "@/app/actions/messenger";
import { RecurringFormSheet, daysLabel } from "./RecurringFormSheet";

type Detail = { name: string; canCheck: boolean; tasks: RecurringDTO[] };

// 조직도 — 멤버별 오늘 반복 할일 진행률(목록) + 멤버 상세(체크·관리).
export function OrgPane({ me }: { me: { id: string; name: string } }) {
  const [rows, setRows] = useState<OrgMemberDTO[]>([]);
  const [sel, setSel] = useState<string | null>(null); // 선택 멤버 id (null=목록)
  const [detail, setDetail] = useState<Detail | null>(null);
  const [addFor, setAddFor] = useState<{ id: string; name: string } | null>(null);
  const [editTask, setEditTask] = useState<RecurringDTO | null>(null);
  const [, start] = useTransition();

  // 목록 폴링(멤버 상세 볼 땐 중지)
  useEffect(() => {
    if (sel) return;
    let alive = true;
    const run = async () => {
      const r = await loadOrgChartAction();
      if (alive) setRows(r.members);
    };
    run();
    const iv = setInterval(() => { if (typeof document !== "undefined" && document.hidden) return; run(); }, 8000);
    return () => { alive = false; clearInterval(iv); };
  }, [sel]);

  // 상세 폴링
  const loadDetail = async (id: string) => setDetail(await loadMemberRecurringAction(id));
  useEffect(() => {
    if (!sel) { setDetail(null); return; }
    let alive = true;
    const run = async () => {
      const r = await loadMemberRecurringAction(sel);
      if (alive) setDetail(r);
    };
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
        <div className="org__head">조직도 · 반복 할일 진행률</div>
        {rows.length === 0 && <div className="org__empty">멤버가 없어요.</div>}
        <div className="org__list">
          {rows.map((m) => {
            const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
            const complete = m.total > 0 && m.done === m.total;
            return (
              <button key={m.id} type="button" className="org__member" onClick={() => setSel(m.id)}>
                <span className="org__ava">{m.name.slice(0, 1)}</span>
                <span className="org__minfo">
                  <span className="org__mname">{m.name}{m.id === me.id ? " (나)" : ""}</span>
                  {m.total === 0 ? (
                    <span className="org__msub">오늘 반복 할일 없음</span>
                  ) : (
                    <span className="org__bar"><span className={`org__barfill${complete ? " done" : ""}`} style={{ width: `${pct}%` }} /></span>
                  )}
                </span>
                <span className={`org__pct${complete ? " done" : ""}`}>
                  {m.total === 0 ? "—" : complete ? "업무 완료" : `${pct}%`}
                </span>
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
        <button type="button" className="org__back" onClick={() => setSel(null)}>‹ 조직도</button>
        {detail && (
          <button type="button" className="org__addbtn" onClick={() => setAddFor({ id: sel, name: detail.name })}>＋ 반복 할일</button>
        )}
      </div>
      <div className="org__dtitle">
        <span className="org__ava org__ava--lg">{(detail?.name ?? "?").slice(0, 1)}</span>
        <div className="org__dinfo">
          <div className="org__dname">{detail?.name ?? ""}{sel === me.id ? " (나)" : ""}</div>
          <div className={`org__dsub${complete ? " done" : ""}`}>
            {total === 0 ? "오늘 반복 할일 없음" : complete ? "업무 완료 · 100%" : `오늘 ${done}/${total} · ${pct}%`}
          </div>
        </div>
      </div>
      {total > 0 && <div className="org__bar org__bar--lg"><span className={`org__barfill${complete ? " done" : ""}`} style={{ width: `${pct}%` }} /></div>}
      {!detail?.canCheck && total > 0 && <div className="org__hint">체크는 본인만 할 수 있어요 (여기선 보기·관리만).</div>}

      <div className="org__tasks">
        {detail && detail.tasks.length === 0 && <div className="org__empty">등록된 반복 할일이 없어요. ＋로 추가하세요.</div>}
        {detail?.tasks.map((t) => (
          <div className={`rtask${t.appliesToday ? "" : " rtask--off"}${t.done ? " is-done" : ""}`} key={t.id}>
            <button type="button" className={`rtask__check${t.done ? " on" : ""}`} onClick={() => toggle(t)} disabled={!t.canCheck} aria-label="완료 체크">{t.done ? "✓" : ""}</button>
            <div className="rtask__main">
              <div className="rtask__title">{t.title}</div>
              <div className="rtask__days">{daysLabel(t.days)}{!t.appliesToday ? " · 오늘 아님" : ""}</div>
            </div>
            <button type="button" className="rtask__edit" onClick={() => setEditTask(t)}>수정</button>
            <button type="button" className="rtask__del" onClick={() => remove(t)} aria-label="삭제">✕</button>
          </div>
        ))}
      </div>

      {addFor && <RecurringFormSheet memberId={addFor.id} memberName={addFor.name} onClose={() => setAddFor(null)} onDone={() => loadDetail(sel)} />}
      {editTask && <RecurringFormSheet memberId={editTask.memberId} editTask={editTask} onClose={() => setEditTask(null)} onDone={() => loadDetail(sel)} />}
    </div>
  );
}
