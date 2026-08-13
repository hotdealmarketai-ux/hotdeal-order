"use client";

import { useRef, useState, useTransition } from "react";
import { Sheet } from "@/components/Sheet";
import {
  addRecurringTaskAction,
  updateRecurringTaskAction,
  type RecurringDTO,
} from "@/app/actions/messenger";

export const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

// 요일 비트마스크 → 라벨("매일" | "월·수·금" 등)
export function daysLabel(days: number): string {
  if (days === 127) return "매일";
  const on = WEEKDAYS.filter((_, i) => (days >> i) & 1);
  return on.length ? on.join("·") : "요일 없음";
}

// 반복 할일 추가/수정 공용 시트 — 제목 + 요일(비트마스크) 선택.
export function RecurringFormSheet({
  memberId,
  memberName,
  editTask,
  onClose,
  onDone,
}: {
  memberId: string; // 대상 멤버(추가 시 소유자)
  memberName?: string;
  editTask?: RecurringDTO | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [title, setTitle] = useState(editTask?.title ?? "");
  const [days, setDays] = useState<number>(editTask?.days ?? 127);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const savingRef = useRef(false); // Enter 연타/이중 제출 방지(중복 생성 차단)

  const toggleDay = (i: number) => setDays((d) => d ^ (1 << i));

  const save = () => {
    if (savingRef.current) return; // 이미 저장 중이면 무시
    const ti = title.trim();
    if (!ti) return setErr("반복 할일을 입력하세요.");
    if (days < 1) return setErr("요일을 하나 이상 선택하세요.");
    setErr("");
    savingRef.current = true;
    start(async () => {
      try {
        const fd = new FormData();
        fd.set("title", ti);
        fd.set("days", String(days));
        let r: { error?: string };
        if (editTask) {
          fd.set("id", editTask.id);
          r = await updateRecurringTaskAction(fd);
        } else {
          fd.set("memberId", memberId);
          r = await addRecurringTaskAction(fd);
        }
        if (r?.error) {
          setErr(r.error);
          return;
        }
        onDone();
        onClose();
      } finally {
        savingRef.current = false;
      }
    });
  };

  return (
    <Sheet onClose={onClose}>
      <div className="sheet__panel recform">
        <div className="recform__title">
          {editTask ? "반복 할일 수정" : "반복 할일 추가"}
          {memberName ? <span className="recform__for"> · {memberName}</span> : null}
        </div>
        <input
          className="input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder="반복 할일 (예: 냉장고 온도 체크)"
          autoFocus
        />
        <div className="recform__dayshead">
          <span className="recform__label">요일</span>
          <button type="button" className={`recform__all${days === 127 ? " on" : ""}`} onClick={() => setDays(127)}>매일</button>
        </div>
        <div className="recform__days">
          {WEEKDAYS.map((w, i) => (
            <button
              key={w}
              type="button"
              className={`recform__day${(days >> i) & 1 ? " on" : ""}${i === 0 ? " sun" : ""}${i === 6 ? " sat" : ""}`}
              onClick={() => toggleDay(i)}
            >
              {w}
            </button>
          ))}
        </div>
        {err && <div className="notice notice--error">{err}</div>}
        <div className="recform__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>취소</button>
          <button type="button" className="btn btn--primary" onClick={save} disabled={pending || !title.trim()}>
            {editTask ? "저장" : "추가"}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
