"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  proposeInventoryCategoriesAction,
  applyInventoryCategoriesAction,
  type CategoryProposal,
} from "@/app/actions/admin";

// 재고 카테고리 AI 자동 분류 — 'AI로 나누기' → 미리보기(대분류/중분류 그룹) → 확인 후 적용.
export function CategoryAutoAssign() {
  const router = useRouter();
  const [mode, setMode] = useState<"idle" | "preview" | "done">("idle");
  const [busy, setBusy] = useState(false);
  const [proposal, setProposal] = useState<Extract<CategoryProposal, { ok: true }> | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  async function propose() {
    setBusy(true);
    setError("");
    const p = await proposeInventoryCategoriesAction();
    setBusy(false);
    if (!p.ok) {
      setError(p.error);
      return;
    }
    setProposal(p);
    setMode("preview");
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true);
    setError("");
    const r = await applyInventoryCategoriesAction(proposal.mapJson);
    setBusy(false);
    if (!r.ok) {
      setError(r.error ?? "적용에 실패했어요.");
      return;
    }
    setResult(`${r.updated}개 품목에 카테고리를 적용했어요.`);
    setMode("done");
    router.refresh();
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="section-label" style={{ margin: "0 0 8px" }}>
        카테고리 자동 분류 (AI)
      </div>

      {mode === "done" ? (
        <div className="notice notice--ok">✓ {result}</div>
      ) : mode === "preview" && proposal ? (
        <>
          <div className="notice notice--ai" style={{ marginBottom: 10 }}>
            AI가 <b>{proposal.itemCount}개 품목</b>을 <b>대분류 {proposal.majorCount}개</b>로 나눴어요.
            확인 후 적용하세요. (적용하면 재고현황·시트에 반영됩니다)
          </div>
          <div className="catprev">
            {proposal.groups.map((g, i) => (
              <div className="catprev__grp" key={i}>
                <div className="catprev__head">
                  <span className="chip">{g.major}</span>
                  {g.minor && <span className="catprev__minor">{g.minor}</span>}
                  <span className="catprev__n">{g.items.length}개</span>
                </div>
                <div className="catprev__items">{g.items.join(", ")}</div>
              </div>
            ))}
          </div>
          <div className="confirm__actions" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setMode("idle")}
              disabled={busy}
            >
              다시
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={apply}
              disabled={busy}
            >
              {busy ? "적용 중…" : "이대로 적용"}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="hint" style={{ marginBottom: 8 }}>
            등록된 재고 전체를 AI가 분석해 대분류/중분류로 나눠줍니다. (미리보기 후 적용 —
            상품 없는 카테고리는 안 보이고, 계란처럼 세분화가 필요 없으면 대분류만 나와요.)
          </p>
          <button
            type="button"
            className="btn btn--soft btn--sm"
            onClick={propose}
            disabled={busy}
          >
            {busy ? "AI 분석 중… (조금 걸려요)" : "AI로 카테고리 나누기"}
          </button>
        </>
      )}

      {error && (
        <div className="notice notice--error" style={{ marginTop: 10 }}>
          {error}
        </div>
      )}
    </div>
  );
}
