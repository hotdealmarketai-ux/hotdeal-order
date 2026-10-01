"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { triggerBackupAction, triggerRestoreVerifyAction } from "@/app/actions/backup";

// 백업 현황판 하단 버튼들 — 지금 백업 / 복원검증 / 다운로드 / 새로고침.
export function BackupActions() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const run = (fn: () => Promise<{ ok: boolean }>, okMsg: string) => {
    setMsg("");
    setErr("");
    start(async () => {
      const r = await fn();
      if (r.ok) setMsg(okMsg);
      else setErr("실행에 실패했어요. GitHub 토큰/권한을 확인해 주세요.");
      router.refresh();
    });
  };

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="btn btn--primary"
          disabled={pending}
          onClick={() =>
            run(
              () => triggerBackupAction("both"),
              "백업을 실행했어요. 1~2분 뒤 '새로고침'을 눌러 결과를 확인하세요.",
            )
          }
        >
          {pending ? "실행 중…" : "지금 백업"}
        </button>
        <button
          type="button"
          className="btn btn--soft"
          disabled={pending}
          onClick={() =>
            run(
              triggerRestoreVerifyAction,
              "복원 검증을 실행했어요. 1~2분 뒤 '새로고침'으로 확인하세요.",
            )
          }
        >
          복원 검증 실행
        </button>
        <a className="btn btn--ghost" href="/api/admin/backup/download?kind=db">
          DB 백업 받기
        </a>
        <a className="btn btn--ghost" href="/api/admin/backup/download?kind=media">
          미디어 백업 받기
        </a>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={pending}
          onClick={() => router.refresh()}
        >
          새로고침
        </button>
      </div>
      {msg && (
        <div className="notice notice--ok" style={{ marginTop: 10 }}>
          {msg}
        </div>
      )}
      {err && (
        <div className="notice notice--error" style={{ marginTop: 10 }}>
          {err}
        </div>
      )}
      <div className="row__sub" style={{ marginTop: 8, color: "var(--muted)" }}>
        ※ 다운로드는 zip으로 받아집니다(안에 DB 덤프 또는 미디어 묶음). 전체 복구 절차는 저장소의 RESTORE.md 참고.
      </div>
    </div>
  );
}
