"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sheet } from "./Sheet";
import { triggerRestoreToBranchAction } from "@/app/actions/backup";
import type { WfRun } from "@/lib/github-backup";

// 복원 마법사 — 최신 백업을 새 Neon 브랜치(격리)에 복원. 운영 데이터는 안 건드림.
export function BackupRestoreWizard({ lastRun }: { lastRun: WfRun | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const badge = (() => {
    if (!lastRun) return null;
    if (lastRun.status !== "completed") return { label: "진행 중", cls: "badge--wait" };
    if (lastRun.conclusion === "success") return { label: "최근 성공", cls: "badge--ok" };
    if (lastRun.conclusion === "failure") return { label: "최근 실패", cls: "badge--danger" };
    return { label: lastRun.conclusion ?? lastRun.status, cls: "" };
  })();

  const close = () => {
    if (pending) return;
    setOpen(false);
    setErr("");
    setDone(false);
  };

  const run = () => {
    setErr("");
    start(async () => {
      const r = await triggerRestoreToBranchAction();
      if (r.ok) setDone(true);
      else setErr("실행에 실패했어요. Neon API 키(NEON_API_KEY)가 등록돼 있는지 확인해 주세요.");
      router.refresh();
    });
  };

  return (
    <>
      <div className="section-label" style={{ marginTop: 20 }}>복원 마법사</div>
      <div className="card">
        <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
          최신 백업을 <b>새 Neon 브랜치(격리된 안전 공간)</b>에 복원합니다. <b>운영 데이터는 전혀 건드리지 않아요.</b>
          사고가 났을 때, 여기서 만든 복원본을 Neon 콘솔에서 확인·승격해 복구합니다. (2~3분 소요)
        </div>
        <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn--primary" onClick={() => setOpen(true)}>
            복원본 만들기
          </button>
          {badge && (
            <span
              className={`badge ${badge.cls}`}
              style={{ minHeight: 32, padding: "0 14px", fontSize: 13, borderRadius: 999 }}
            >
              {badge.label}
            </span>
          )}
          {lastRun?.url && (
            <a href={lastRun.url} target="_blank" rel="noreferrer" className="row__sub" style={{ color: "var(--muted)" }}>
              기록 보기
            </a>
          )}
        </div>
      </div>

      {open && (
        <Sheet onClose={close}>
          <div className="sheet__panel" style={{ maxWidth: 460 }}>
            <div className="sheet__head">
              <div className="sheet__title">복원본을 만들까요?</div>
              <button type="button" className="sheet__close" aria-label="닫기" onClick={close}>
                ✕
              </button>
            </div>
            {!done ? (
              <>
                <div style={{ fontSize: 14, color: "var(--fg)", marginTop: 12, lineHeight: 1.7 }}>
                  최신 백업을 <b>새 Neon 브랜치</b>에 복원합니다.
                  <br />• 운영(실서비스) 데이터는 <b>그대로</b> 둬요.
                  <br />• 2~3분 걸리고, 끝나면 Neon에 <b>restore-…</b> 라는 브랜치가 생깁니다.
                  <br />• 그 브랜치가 백업 시점의 전체 복원본이에요.
                </div>
                <div className="row__sub" style={{ marginTop: 10, color: "var(--muted)" }}>
                  ※ Neon API 키(NEON_API_KEY)가 등록돼 있어야 작동합니다.
                </div>
                {err && (
                  <div className="notice notice--error" style={{ marginTop: 10 }}>
                    {err}
                  </div>
                )}
                <div className="sheet__foot">
                  <button type="button" className="btn btn--ghost" onClick={close} disabled={pending}>
                    취소
                  </button>
                  <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={run} disabled={pending}>
                    {pending ? "시작하는 중…" : "복원본 만들기"}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="notice notice--ok" style={{ marginTop: 12 }}>
                  ✓ 복원을 시작했어요. 2~3분 뒤 이 화면에서 '새로고침'으로 결과를 확인하세요.
                </div>
                <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 10, lineHeight: 1.6 }}>
                  완료되면 Neon 콘솔 → 브랜치 목록에 <b>restore-…</b> 브랜치가 생깁니다. 그게 백업 복원본이에요.
                  실제 복구(승격) 절차는 저장소의 RESTORE.md를 참고하세요.
                </div>
                <div className="sheet__foot">
                  <button type="button" className="btn btn--primary" style={{ flex: 1 }} onClick={close}>
                    닫기
                  </button>
                </div>
              </>
            )}
          </div>
        </Sheet>
      )}
    </>
  );
}
