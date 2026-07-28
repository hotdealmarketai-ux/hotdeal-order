"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  diagnoseSheetSyncAction,
  type SheetSyncDiag,
} from "@/app/actions/admin";

// 구글시트 연동 점검 — 관리자가 프로덕션에서 눌러 원인을 특정 + 지금 강제 반영.
// (프로덕션 env/시트 공유 상태를 로컬에서 볼 수 없어 서버에서 진단하게 함.)
export function SheetSyncDiagnose() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [diag, setDiag] = useState<SheetSyncDiag | null>(null);

  async function run() {
    setBusy(true);
    try {
      const d = await diagnoseSheetSyncAction();
      setDiag(d);
      if (d.push.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const ok = diag?.push.ok;

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        구글시트 연동 점검
      </div>
      <p className="hint" style={{ marginBottom: 8 }}>
        시트에 최신 재고·카테고리가 안 보이면 눌러 주세요. 원인을 확인하고, 정상이면
        지금 바로 시트에 반영합니다.
      </p>
      <button
        type="button"
        className="btn btn--soft btn--sm"
        onClick={run}
        disabled={busy}
      >
        {busy ? "점검 중…" : "점검하고 지금 반영"}
      </button>

      {diag && (
        <div
          className={`notice ${ok ? "notice--ok" : "notice--error"}`}
          style={{ marginTop: 10 }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>
            {ok ? "✓ 시트에 반영했어요" : "⚠ 시트 반영 안 됨"}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.55 }}>{diag.hint}</div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12,
              color: "var(--muted)",
              lineHeight: 1.6,
              wordBreak: "break-all",
            }}
          >
            자격증명: {diag.configured ? "있음" : "없음"}
            {diag.clientEmail ? ` · 서비스계정 ${diag.clientEmail}` : ""}
            <br />
            재고 {diag.itemCount}건 · 분류됨 {diag.categorized}건
            <br />
            마지막 반영:{" "}
            {diag.lastPushAt
              ? new Date(diag.lastPushAt).toLocaleString("ko-KR", {
                  timeZone: "Asia/Seoul",
                })
              : "없음"}
            {!ok && diag.push.error ? ` · 오류코드 ${diag.push.error}` : ""}
          </div>
        </div>
      )}
    </div>
  );
}
