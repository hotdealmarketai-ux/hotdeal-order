"use client";

// ⚠ 임시(1회성) — 전체 재고 카테고리 재분류 적용 버튼. 미리보기(드라이런)로 매칭을 확인한 뒤 적용.
// 적용 검증 후 이 컴포넌트와 _recat.ts, 재고현황 페이지의 사용처를 제거한다.
import { useState } from "react";
import { runFullRecatAction, type RecatResult } from "@/app/actions/_recat";

export function RecatApplyButton() {
  const [res, setRes] = useState<RecatResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);

  async function preview() {
    setBusy(true);
    try {
      const r = await runFullRecatAction(false);
      setRes(r);
      setApplied(false);
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    setBusy(true);
    try {
      const r = await runFullRecatAction(true);
      setRes(r);
      setApplied(r.ok && r.commit);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12, borderColor: "var(--green-700, #0f6b45)" }}>
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        전체 카테고리 재분류 (1회 적용)
      </div>
      <p className="hint" style={{ marginBottom: 10 }}>
        새로 정리한 26개 대분류로 전체 재고 카테고리를 한 번에 바꿉니다. 먼저 <b>미리보기</b>로
        매칭을 확인한 뒤 적용하세요. (수량·미수·발주와 무관, 카테고리 표시만 변경)
      </p>

      {!applied && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="btn btn--soft btn--sm" onClick={preview} disabled={busy}>
            {busy ? "확인 중…" : "미리보기"}
          </button>
          {res && res.ok && !res.commit && (
            <button type="button" className="btn btn--primary btn--sm" onClick={apply} disabled={busy}>
              {busy ? "적용 중…" : `적용하기 (${res.willChange}개 변경)`}
            </button>
          )}
        </div>
      )}

      {res && (
        <div
          className={`notice ${res.ok ? (applied ? "notice--ok" : "") : "notice--error"}`}
          style={{ marginTop: 12, fontSize: 13, lineHeight: 1.7 }}
        >
          {!res.ok && <div>⚠ {res.error ?? "실패"}</div>}
          {res.ok && applied && (
            <div>
              ✅ 적용 완료 — <b>{res.applied}개</b> 품목 카테고리 변경됨 (재고 {res.dbCount}개 중 매칭{" "}
              {res.matched}개).
            </div>
          )}
          {res.ok && !applied && (
            <>
              <div>
                재고 <b>{res.dbCount}</b>개 · 매핑 {res.mapCount}개 · 매칭{" "}
                <b>{res.matched}</b>개 · 변경 예정 <b>{res.willChange}</b>개
              </div>
              {res.dbNotInMap.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--muted)" }}>
                  매핑에 없어 <b>그대로 유지</b>({res.dbNotInMap.length}개): {res.dbNotInMap.join(", ")}
                </div>
              )}
              {res.mapNotInDb.length > 0 && (
                <div style={{ marginTop: 6, color: "var(--muted)" }}>
                  재고에 없는 매핑({res.mapNotInDb.length}개, 무시됨): {res.mapNotInDb.join(", ")}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
